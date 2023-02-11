#!/usr/bin/python2
# -*- coding: utf-8 -*-
# #############################################################################
#    Copyright (C) 2018 manatlan manatlan[at]gmail(dot)com
#
# MIT licence
#
# https://github.com/manatlan/vbuild
# #############################################################################
__version__ = "0.8.1"  # py2.7 & py3.5 !!!!

import re, os, json, glob, itertools, traceback, subprocess, pkgutil

try:
    from HTMLParser import HTMLParser
    import urllib2 as urlrequest
    import urllib as urlparse
except ImportError:
    from html.parser import HTMLParser
    import urllib.request as urlrequest
    import urllib.parse as urlparse

transHtml = lambda x: x  # override them to use your own transformer/minifier
transStyle = lambda x: x
transScript = lambda x: x

partial = ""
fullPyComp = True  # 3 states ;-)
# None  : minimal py comp, it's up to u to include "pscript.get_full_std_lib()"
# False : minimal py comp, vbuild will include the std lib
# True  : each component generate its needs (default)

hasLess = bool(pkgutil.find_loader("lesscpy"))
hasSass = bool(pkgutil.find_loader("scss"))
hasClosure = bool(pkgutil.find_loader("closure"))


class VBuildException(Exception):
    pass


def minimize(code):
    if hasClosure:
        return jsmin(code)
    else:
        return jsminOnline(code)


def jsminOnline(code):
    """ JS-minimize (transpile to ES5 JS compliant) thru a online service
        (https://closure-compiler.appspot.com/compile)
    """
    data = [
        ("js_code", code),
        ("compilation_level", "SIMPLE_OPTIMIZATIONS"),
        ("output_format", "json"),
        ("output_info", "compiled_code"),
        ("output_info", "errors"),
    ]
    try:
        req = urlrequest.Request(
            "https://closure-compiler.appspot.com/compile",
            urlparse.urlencode(data).encode("utf8"),
            {"Content-type": "application/x-www-form-urlencoded; charset=UTF-8"},
        )
        response = urlrequest.urlopen(req)
        r = json.loads(response.read())
        response.close()
        code = r.get("compiledCode", None)
    except Exception as e:
        raise VBuildException("minimize error: %s" % e)
    if code:
        return code
    else:
        raise VBuildException("minimize error: %s" % r.get("errors", None))


def jsmin(code):  # need java & pip/closure
    """ JS-minimize (transpile to ES5 JS compliant) with closure-compiler
        (pip package 'closure', need java !)
    """
    if hasClosure:
        import closure  # py2 or py3
    else:
        raise VBuildException(
            "jsmin error: closure is not installed (sudo pip closure)"
        )
    cmd = ["java", "-jar", closure.get_jar_filename()]
    try:
        p = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stdin=subprocess.PIPE, stderr=subprocess.PIPE
        )
    except Exception as e:
        raise VBuildException("jsmin error: %s" % e)
    out, err = p.communicate(code.encode("utf8"))
    if p.returncode == 0:
        return out.decode("utf8")
    else:
        raise VBuildException("jsmin error:" + err.decode("utf8"))


def preProcessCSS(cnt, partial=""):
    """ Apply css-preprocessing on css rules (according css.type) using a partial or not
        return the css pre-processed
    """
    if cnt.type in ["scss", "sass"]:
        if hasSass:
            from scss.compiler import compile_string  # lang="scss"

            return compile_string(partial + "\n" + cnt.value)
        else:
            print("***WARNING*** : miss 'sass' preprocessor : sudo pip install pyscss")
            return cnt.value
    elif cnt.type in ["less"]:
        if hasLess:
            import lesscpy, six

            return lesscpy.compile(
                six.StringIO(partial + "\n" + cnt.value), minify=True
            )
        else:
            print("***WARNING*** : miss 'less' preprocessor : sudo pip install lesscpy")
            return cnt.value
    else:
        return cnt.value


class Content:
    def __init__(self, v, typ=None):
        self.type = typ
        self.value = v.strip("\n\r\t ")

    def __repr__(self):
        return self.value


class VueParser(HTMLParser):
    """ Just a class to extract <template/><script/><style/> from a buffer.
        self.html/script/styles/scopedStyles are Content's object, or list of.
    """

    voidElements = "area base br col command embed hr img input keygen link menuitem meta param source track wbr".split(
        " "
    )

    def __init__(self, buf, name=""):
        """ Extract stuff from the vue/buffer 'buf'
            (name is just useful for naming the component in exceptions)
        """
        HTMLParser.__init__(self)
        self.name = name
        self._p1 = None
        self._level = 0
        self._scriptLang = None
        self._styleLang = None
        self.rootTag = None
        self.script_setup=None
        self.html, self.script, self.styles, self.scopedStyles = None, None, [], []
        self.feed(buf.strip("\n\r\t "))

    def handle_starttag(self, tag, attrs):
        self._tag = tag

        # don't manage if it's a void element
        if tag not in self.voidElements:
            self._level += 1

            attributes = dict([(k.lower(), v and v.lower()) for k, v in attrs])
            self.attributes=attributes
            if tag == "style" and attributes.get("lang", None):
                self._styleLang = attributes["lang"]
            if tag == "script" and attributes.get("lang", None):
                self._scriptLang = attributes["lang"]
            if self._level == 1 and tag == "template":
                if self._p1 is not None:
                    raise VBuildException(
                        "Component %s contains more than one template" % self.name
                    )
                self._p1 = self.getOffset() + len(self.get_starttag_text())
            if self._level == 2 and self._p1:  # test p1, to be sure to be in a template
                if self.rootTag is not None:
                    raise VBuildException(
                        "Component %s can have only one top level tag !" % self.name
                    )
                self.rootTag = tag

    def handle_endtag(self, tag):
        if tag not in self.voidElements:
            if (
                tag == "template" and self._p1
            ):  # don't watch the level (so it can accept mal formed html
                self.html = Content(self.rawdata[self._p1 : self.getOffset()])
            self._level -= 1

    def handle_data(self, data):
        if self._level == 1:
            if self._tag == "script":
                if "setup" in self.attributes:
                    self.script_setup = Content(data, self._scriptLang)
                else:
                    self.script = Content(data, self._scriptLang)
            if self._tag == "style":
                if "scoped" in self.get_starttag_text().lower():
                    self.scopedStyles.append(Content(data, self._styleLang))
                else:
                    self.styles.append(Content(data, self._styleLang))

    def getOffset(self):
        lineno, off = self.getpos()
        rtn = 0
        for _ in range(lineno - 1):
            rtn = self.rawdata.find("\n", rtn) + 1
        return rtn + off


def mkPrefixCss(css, prefix=""):
    """Add the prexix (css selector) to all rules in the 'css'
       (used to scope style in context)
    """
    medias = []
    while "@media" in css:
        p1 = css.find("@media", 0)
        p2 = css.find("{", p1) + 1
        lv = 1
        while lv > 0:
            lv += 1 if css[p2] == "{" else -1 if css[p2] == "}" else 0
            p2 += 1
        block = css[p1:p2]
        mediadef = block[: block.find("{")].strip()
        mediacss = block[block.find("{") + 1 : block.rfind("}")].strip()
        css = css.replace(block, "")
        medias.append((mediadef, mkPrefixCss(mediacss, prefix)))

    lines = []
    css = re.sub(re.compile("/\*.*?\*/", re.DOTALL), "", css)
    css = re.sub(re.compile("[ \t\n]+", re.DOTALL), " ", css)
    for rule in re.findall(r"[^}]+{[^}]+}", css):
        sels, decs = rule.split("{", 1)
        if prefix:
            l = [
                (prefix + " " + i.replace(":scope", "").strip()).strip()
                for i in sels.split(",")
            ]
        else:
            l = [(i.strip()) for i in sels.split(",")]
        lines.append(", ".join(l) + " {" + decs.strip())
    lines.extend(["%s {%s}" % (d, c) for d, c in medias])
    return "\n".join(lines).strip("\n ")


class VBuild:
    """ the main class, provide an instance :

        .style : contains all the styles (scoped or not)
        .script: contains a (js) Vue.component() statement to initialize the component
        .html  : contains the <script type="text/x-template"/>
        .tags  : list of component's name whose are in the vbuild instance
    """

    def __init__(self, filename, content,dir_project=None):
        """ Create a VBuild class, by providing a :
                filename: which will be used to name the component, and create the namespace for the template
                content: the string buffer which contains the sfc/vue component
        """
        self._script_setup=[]
        self.dir_project=dir_project
        if not filename:
            raise VBuildException("Component %s should be named" % filename)
        
        if type(content) != type(filename):  # only py2, transform
            if type(content) == unicode:  # filename to the same type
                filename = filename.decode("utf8")  # of content to avoid
            else:  # troubles with implicit
                filename = filename.encode("utf8")  # ascii conversions (regex)

        name = os.path.splitext(os.path.basename(filename))[0]
        if filename.startswith(os.getcwd()):
            unique = filename[len(os.getcwd()):-4].replace("/", "-").replace("\\", "-").replace(":", "-").replace(".", "-")
        else:
            part=filename.split("/")
            i=part.index("src")
            unique = "-".join(part[i:])[:-4]
        # unique = name+"-"+''.join(random.choice(string.letters + string.digits) for _ in range(8))
        tplId = "tpl-" + unique
        dataId = "data-" + unique
    
        vp = VueParser(content, filename)
        if vp.html is None:
            raise VBuildException("Component %s doesn't have a template" % filename)
        else:
            
            dataId=""
            html = re.sub(r"^<([\w-]+)", r"<\1 %s" % dataId, vp.html.value)
         
            self.tags = [name]
            # self.html="""<script type="text/x-template" id="%s">%s</script>""" % (tplId, transHtml(html) )
            self._html = [(tplId, html)]

            self._styles = []
            for style in vp.styles:
                self._styles.append(("", style, filename))
            for style in vp.scopedStyles:
                self._styles.append(("*[%s]" % dataId, style, filename))
            # and set self._script !
            if vp.script_setup and ("class Component:" in vp.script_setup.value):
                ######################################################### python
                try:
                    self._script_setup = [
                        mkPythonVueComponent2(
                            name, "#" + tplId, vp.script_setup.value, filename,fullPyComp,dir_project=self.dir_project
                        )
                    ]
                except Exception as e:
                    raise VBuildException(
                        "Python Component '%s' is broken : %s"
                        % (filename, traceback.format_exc())
                    )
            else:
                ######################################################### js
                try:
                    if vp.script_setup and vp.script_setup.type=="python":
                        self._script_setup = [
                            mkClassicVueComponent2(
                                name, "#" + tplId, vp.script_setup and vp.script_setup.value,dir_project=self.dir_project
                            )
                        ]
                    elif vp.script_setup:
                        self._script_setup = [
                            vp.script_setup.value
                        ]
                    with open("ERROR8.txt","a") as f:
                        f.write(str(self.dir_project)+"\n")
                except Exception as e:
                    with open("NODE.txt","w") as f:
                        f.write(str(e))
                    print("qqqqqqqq ",e)
                    raise VBuildException(
                        "JS Component %s contains a bad script" % filename
                    )

            # and set self._script !
            if vp.script and ("class Component:" in vp.script.value):
                ######################################################### python
                try:
                    self._script = [
                        mkPythonVueComponent(
                            name, "#" + tplId, vp.script.value, filename,fullPyComp,dir_project=self.dir_project
                        )
                    ]
                except Exception as e:
                    raise VBuildException(
                        "Python Component '%s' is broken : %s"
                        % (filename, traceback.format_exc())
                    )
            else:
                ######################################################### js
                try:
                    self._script = [
                        mkClassicVueComponent(
                            name, "#" + tplId, vp.script and vp.script.value
                        )
                    ]
                except Exception as e:
                    raise VBuildException(
                        "JS Component %s contains a bad script" % filename
                    )

    @property
    def html(self):
        """ Return HTML (script tags of embbeded components), after transHtml"""
        l = []
        for tplId, html in self._html:
            l.append(
                """<template id="%s">%s</template>"""
                % (tplId, transHtml(html))
            )
        return "\n".join(l)

    @property
    def script(self):
        """ Return JS (js of embbeded components), after transScript"""
        js = "\n".join(self._script)
        isPyComp = "_pyfunc_op_instantiate(" in js  # in fact : contains
        isLibInside = "var _pyfunc_op_instantiate" in js
        import pscript

        if (fullPyComp is False) and isPyComp and not isLibInside:
            import pscript
            return transScript(pscript.get_full_std_lib() + "\n" + js)
        else:
            
            return transScript(js)
    @property
    def script_setup(self):
        """ Return JS (js of embbeded components), after transScript"""
        if self._script_setup:
            js = "\n".join(self._script_setup)
        else:
            js=""
        isPyComp = "_pyfunc_op_instantiate(" in js  # in fact : contains
        isLibInside = "var _pyfunc_op_instantiate" in js
        import pscript

        if (fullPyComp is False) and isPyComp and not isLibInside:
            import pscript
            return transScript(pscript.get_full_std_lib() + "\n" + js)
        else:
            
            return transScript(js)


    @property
    def style(self):
        """ Return CSS (styles of embbeded components), after preprocess css & transStyle"""
        style = ""
        try:
            for prefix, s, filename in self._styles:
                style += mkPrefixCss(preProcessCSS(s, partial), prefix) + "\n"
        except Exception as e:
            raise VBuildException(
                "Component '%s' got a CSS-PreProcessor trouble : %s" % (filename, e)
            )
        return transStyle(style).strip()

    def __add__(self, o):
        same = set(self.tags).intersection(set(o.tags))
        if same:
            raise VBuildException("You can't have multiple '%s'" % list(same)[0])
        self._html.extend(o._html)
        self._script_setup.extend(o._script_setup)
        self._script.extend(o._script)
        self._styles.extend(o._styles)
        self.tags.extend(o.tags)
        return self

    def __radd__(self, o):
        return self if o == 0 else self.__add__(o)

    def __getstate__(self):
        return self.__dict__

    def __setstate__(self, d):
        self.__dict__ = d

    def __repr__(self):
        """ return an html ready represenation of the component(s) """
        aa = self.script_setup
        hh = self.html
        jj = self.script
        ss = self.style
        s = ""
        if aa:
            s += "<script setup>\n%s\n</script>\n" % aa
        if ss:
            s += "<style>\n%s\n</style>\n" % ss
        if hh:
            s += "%s\n" % hh
        if jj:
            s += "<script>\n%s\n</script>\n" % jj
        return s


def mkClassicVueComponent(name, template, code):
    if code is None:
        js = "{}"
    else:
        p1 = code.find("{")
        p2 = code.rfind("}")
        if 0 <= p1 <= p2:
            js = code[p1 : p2 + 1]
        else:
    
            raise Exception("Can't find valid content inside '{' and '}'")

    return """var %s = Vue.component('%s', %s);""" % (
        name,
        name,
        js.replace("{", "{template:'%s'," % template, 1),
    )

def mkClassicVueComponent2(name, template, code,dir_project=None):
    if code is None:
        js = ""
        return js
    else:
        import pscript
        code = pscript.py2js(
            code, inline_stdlib=False,filename=None,dir_project=dir_project
        )  # https://pscript.readthedocs.io/en/latest/api.html
        code="\n".join(code.split("\n")[:-1])
      

        return code

class JsModule:
    def __init__(self,name):
        self.__name__=name
    def __repr__(self):
        return self.__name__
    def __getattr__(self,elem):
        return JsModule(elem)
    def __call__(self,*args,**kwargs):
        return JsModule("JsModule")

def require(path):
    import re
    folder=os.path.dirname(__file_component__)
    fullpath=os.path.join(folder+"/"+path)
    fullpath2=os.path.abspath(__file_component__)

    with open(fullpath2) as f:
        content=f.read()
    
    #node=VBuild(path,content)
    
    
    match=re.search(r"(?P<variable>\w+)\s*?=\s*?require\(\""+path.replace(".",r"\."),content)
    """
    if path.startswith("http"):
        match=
    """
    #variable=re.search(r"(?P<variable>\w+)\s+?=\s+?require\(\""+path,globals()["__code__"]).groups()[0]
    
    if match:

        globals()[match.groups()[0]]=JsModule(match.groups()[0])    
    


        
    return JsModule("JsModule")

def alert(alerta):
    pass

def mkPythonVueComponent(name, template, code, __file_component__,genStdLibMethods=True,dir_project=None):
    """ Transpile the component 'name', which have the template 'template',
        and the code 'code' (which should contains a valid Component class)
        to a valid Vue.component js statement.

        genStdLibMethods : generate own std lib method inline (with the js)
                (if False: use pscript.get_full_std_lib() to get them)
    """
    import pscript,re
    from dotenv import load_dotenv
    load_dotenv()

    code = code.replace(
        "class Component:", "class C:"
    )  # minimize class name (todo: use py2js option for that)

    globals()["require"]=require
    class Window:
        def __getattr__(self,key):
            return key
    globals()["window"]=Window()
    globals()["document"]=JsModule("document")
    globals()["jsevent"]=lambda *args,**kwargs:lambda *args,**kwargs:None
    globals()["__file_component__"]=__file_component__
    globals()["__code__"]=code
    globals()["console"]=type("console",(),{"log":lambda *args:None})
    import sys
    __file__=__file_component__
    sys.path.append(os.path.dirname(__file_component__))
    
    
    pattern0=r"from\s *?(?P<package>[\w|\.]+)\s*? import (?P<module>[\w|\.]+) as (?P<variable>[\w]+)"
    pattern=r"from\s *?(?P<package>[\w|\.]+)\s*? import (?P<module>[\w|\.]+)"
    pattern2=r"(?P<variable>\w+)\s*=\s*require\('(?P<package>[\w|\@|\/|-]+)"
    #code=re.sub(pattern,r"\g<module>=type('\g<module>',(),{})",code)
    matches=[]
    _vars={}
    for match in re.finditer(pattern0,code):
        matches.append(match.groupdict())
        _vars[match["variable"]]=JsModule(match["module"])

    for match in re.finditer(pattern,code):
        matches.append(match.groupdict())
        _vars[match["module"]]=JsModule(match["module"])

    

    for match in re.finditer(pattern2,code):
  
        if match["variable"] not in _vars:
            _vars[match["variable"]]=JsModule(match["variable"])
    globals().update(_vars)

    code=re.sub(pattern0,r"\g<variable>=require('\g<package>.py').\g<module>",code)
    code=re.sub(pattern,r"\g<module>=require('\g<package>.py').\g<module>",code)
    for match in matches:
        
        path=None


        if match['package'].startswith(".") and not match['package'].startswith(".."):
            path=os.path.dirname(__file_component__)+match['package'].replace('.','/')
            _package="."+match['package'].replace('.','/')
        elif match['package'].startswith("..") :
            _package="."+match['package'].replace('.','/').replace("//","/../")
        else:
            _package=match['package'].replace('.','/')
        if not path:

            code=re.sub(rf"(require\(\'{match['package']}\.py\'\))",rf"require('{_package}')",code)

        else:
            if os.path.isdir(path):
                _package+="/__init__"

            code=re.sub(rf"(require\(\'{match['package']}\.py\'\))",rf"require('{_package}.py')",code)

  
    exec(code, globals(), locals())

    
    klass = locals()["C"]

    computeds = []
    watchs = []
    methods = []
    components={} # nuevo 
    lifecycles = []
    classname = klass.__name__
    props = []
    emits = []
    computeds2={}
    for oname, obj in vars(klass).items():
        if callable(obj):
            
            if not oname.startswith("_"):
         
                if oname.startswith("COMPUTED_"):
                    if oname.startswith("COMPUTED_GET_"):
                        name=oname[len("COMPUTED_GET_"):]
                        if name not in computeds2:
                            computeds2[name]={
                                "get": "%s.prototype.%s" % (classname, oname)
                            }
                        else:
                            computeds2[name]["get"]="%s.prototype.%s" % (classname, oname)
                    elif oname.startswith("COMPUTED_SET_"):
                        name=oname[len("COMPUTED_SET_"):]
                        if name not in computeds2:
                            computeds2[name]={
                                "set": "%s.prototype.%s" % (classname, oname)
                            }
                        else:
                            computeds2[name]["set"]="%s.prototype.%s" % (classname, oname)

                    else:
                        computeds.append(
                            "%s: %s.prototype.%s," % (oname[9:], classname, oname)
                        )
                elif oname.startswith("WATCH_"):

                    watchs.append(

                        '"%s": %s.prototype.%s,' % (oname[len("WATCH_"):], classname, oname)
                        )
                    """
                    if obj.__defaults__:
                        varwatch = obj.__defaults__[
                            0
                        ]  # not neat (take the first default as whatch var)
                        watchs.append(
                            '"%s": %s.prototype.%s,' % (varwatch, classname, oname)
                        )
                    else:
                        raise VBuildException(
                            "name='var_to_watch' is not specified in %s" % oname
                        )
                    """
                elif oname in [
                    "BEFOREROUTEUPDATE",
                    "BEFOREMOUNT",
                    "MOUNTED",
                    "CREATED",
                    "UPDATED",
                    "BEFOREUPDATE",
                    "BEFOREDESTROY",
                    "DESTROYED",
                    "DATA",
                    "SETUP",
                ]:
                    if oname=="BEFOREMOUNT":
                        lifecycles.append(
                            "beforeMount: %s.prototype.%s," % ( classname, oname)
                        )
                    elif oname=="BEFOREROUTEUPDATE":
                        lifecycles.append(
                            "beforeRouteUpdate: %s.prototype.%s," % ( classname, oname)
                        )
                    elif oname=="BEFOREUPDATE":
                        lifecycles.append(
                            "beforeUpdate: %s.prototype.%s," % ( classname, oname)
                        )
                    else:
                        lifecycles.append(
                            "%s: %s.prototype.%s," % (oname.lower(), classname, oname)
                        )

                
                else:
                    methods.append("%s: %s.prototype.%s," % (oname, classname, oname))
            elif oname == "__init__":
                props = list(obj.__code__.co_varnames)[1:]
        else:
            if oname=="components":
                components=obj
            if oname=="props":
                props=obj
            if oname=="emits":
                emits=obj
    sub=""
    for elem in computeds2:
        sub=elem+":{"
        for method in computeds2[elem]:
            if method=="get":
                sub+=method+"(){ return "+computeds2[elem][method]+".bind(this)()},"
            else:
                sub+=method+"(value){"+computeds2[elem][method]+".bind(this)(value)},"
        sub+="},"
        computeds.append(sub)
    print("//-------------------")
    methods = "\n".join(methods)
    computeds = "\n".join(computeds)
    watchs = "\n".join(watchs)
    lifecycles = "\n".join(lifecycles)

    pyjs = pscript.py2js(
        code, inline_stdlib=genStdLibMethods,filename=__file_component__,dir_project=self.dir_project
    )  # https://pscript.readthedocs.io/en/latest/api.html

    pyjs=re.sub(r"require\(\"(?P<package>http[\w|\@|\/|\.|:|-]+)\"\)",r"import '\g<package>'",pyjs)
    pyjs=re.sub(r"require\(\'(?P<package>http[\w|\@|\/|\.|:|-]+)\'\)",r"import '\g<package>'",pyjs)



    
    
    return (
        """
//este codigo

    %(pyjs)s

    function construct(constructor, args) {
        function F() {return constructor.apply(this, args);}
        F.prototype = constructor.prototype;
        return new F();
    }

    export default{
        name: "%(name)s",
        props: %(props)s,
        emits: %(emits)s,
        components: %(components)s,
        computed: {
            %(computeds)s
        },
        methods: {
            %(methods)s
        },
        watch: {
            %(watchs)s
        },
        %(lifecycles)s
    }

"""
        % locals()
    )


def render(*filenames,**kwargs):
    """ Helpers to render VBuild's instances by providing filenames or pattern (glob's style)"""
    isPattern = lambda f: ("*" in f) or ("?" in f)
    dir_project=None
    if "dir_project" in kwargs:
        dir_project=kwargs["dir_project"]
    files = []
    
    for i in filenames:
        if isinstance(i, list):
            files.extend(i)
        else:
            files.append(i)

    files = [glob.glob(i) if isPattern(i) else [i] for i in files]
    files = list(itertools.chain(*files))
    
    ll = []
    l2=[]
    for f in files:
        try:
            with open(f, "r+") as fid:
                content = fid.read()
        except IOError as e:
            raise VBuildException(str(e))
        if 'lang="python"' in content or "lang='python'" in content:
            ll.append(VBuild(f, content,dir_project))
        else:
            l2.append(content)
    
    if ll:
        return sum(ll)
    else:
        return "\n".join(l2)

def build(path="src/",dir_project=None):
    try:

        d=render(path,dir_project=dir_project)
        print(d)
     
    except Exception as e:
        import traceback
        from io import  StringIO
        s=StringIO()
        traceback.print_exc(file=s)
        s.seek(0)
        msg=s.read()
 
        with open(path+".error","w") as f:
            with open(path) as f2:
                f.write(str(msg)+"\n"+f2.read())
    
    

def src_py2js(path,dir_project):
    import pscript
    with open(path) as f:
        
        compiled=pscript.py2js(f.read(),inline_stdlib=True,filename=path,dir_project=dir_project)

        print(compiled)

if __name__ == "__main__":
    print("Less installed (lesscpy)    :", hasLess)
    print("Sass installed (pyScss)     :", hasSass)
    print("Closure installed (closure) :", hasClosure)
    if os.path.isfile("tests.py"):
        exec(open("tests.py").read())
    # ~ if(os.path.isfile("test_py_comp.py")): exec(open("test_py_comp.py").read())
