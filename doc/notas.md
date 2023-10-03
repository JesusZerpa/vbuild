Para corregir el problema que nuxt tiene por alguna razon con los setups de python en vue hay que editar el archivo 

/home/jzerpa/workspace/machine_learning/tasksmanager/src/node_modules/nuxt/dist/index.mjs

enserrando el 
````
walk(this.parse(code, {
        sourceType: "module",
        ecmaVersion: "latest"
      }), 
...
````
en un condicional 
```
if (query["lang.python"]==undefined){ 
```
Esto tambien optimizara los tiempos de carga



Un componente asincrono de vue se ve asi 

```
import {createHotContext as __vite__createHotContext} from "/_nuxt/@vite/client";
import.meta.hot = __vite__createHotContext("/components/Prueba.vue");

//este codigo

function Array_from(array) {
    return Array.from(array)
}
function jscall(listener, params) {
    return function(fn) {

        listener(params, fn)
    }
}
function jsmethod(listener) {
    return function(fn) {
        console.log("uuuuuuu", listener, fn.name, listener[fn.name.slice("bound flx_".length)])
        listener[fn.name.slice("bound flx_".length)](fn)
    }
}
function __new__(obj) {
    return new obj
}

function jsevent(listener, params=null) {
    return function(fn) {

        if (fn.name.indexOf("bound flx_") == 0) {

            listener(fn.name.slice("bound flx_".length), fn, params)
        } else if (fn.name.indexOf("flx_") == 0) {

            listener(fn.name.slice("flx_".length), fn, params)
        } else {
            listener(fn.name, fn, params)
        }

        return fn
    }
}

function jsbind(obj, attr) {

    return function(fn) {
        if (fn.name.indexOf("flx_") == 0) {

            obj[attr](fn.name.slice("flx_".length), fn)
        } else if (fn.name.indexOf("bound flx_") == 0) {
            obj[fn.name.slice("bound flx_".length)] = fn
        } else {
            obj[attr](fn.name, fn)
        }

    }
}
function jsassign(obj) {
    return function(fn) {

        if (fn.name.indexOf("bound flx_") == 0) {
            obj[fn.name.slice("bound flx_".length)] = fn
        } else if (fn.name.indexOf("flx_") == 0) {
            obj[fn.name.slice("flx_".length)] = fn
        } else {
            obj[fn.name] = fn
        }
    }
}
var _pyfunc_op_instantiate = function(ob, args) {
    // nargs: 2

    if ((typeof ob === "undefined") || (typeof window !== "undefined" && window === ob) || (typeof global !== "undefined" && global === ob)) {
        throw "Class constructor is called as a function.";
    }
    for (var name in ob) {
        try {
            if (Object[name] === undefined && typeof ob[name] === 'function' && !ob[name].nobind) {
                ob[name] = ob[name].bind(ob);
                ob[name].__name__ = name;
            }
        } catch (e) {//si ocurrio un error lo mas seguro es que sea por las propiedades
        }

    }
    if (ob.__init__) {
        ob.__init__.apply(ob, args);
    }
};
var C;
C = function() {
    _pyfunc_op_instantiate(this, arguments);
}
C.prototype._base_class = Object;
C.prototype.__name__ = "C";

C.prototype.click = function() {
    alert("Hola");
    return null;
}
;

export {C}

function construct(constructor, args) {
    function F() {
        return constructor.apply(this, args);
    }
    F.prototype = constructor.prototype;
    return new F();
}

const _sfc_main = {
    name: "Prueba",
    props: [],
    emits: [],
    components: {},
    computed: {
    },
    methods: {
        click: C.prototype.click,
    },
    watch: {
    },

}

import {resolveComponent as _resolveComponent, createVNode as _createVNode, createTextVNode as _createTextVNode, openBlock as _openBlock, createElementBlock as _createElementBlock} from "/_nuxt/node_modules/.vite/deps/vue.js?v=cce66249"

function _sfc_render(_ctx, _cache, $props, $setup, $data, $options) {
    const _component_q_btn = _resolveComponent("q-btn")

    return (_openBlock(),
    _createElementBlock("div", null, [_createTextVNode(" hola mundo "), _createVNode(_component_q_btn, {
        label: "Has click",
        onClick: $options.click
    }, null, 8 /* PROPS */
    , ["onClick"])]))
}

_sfc_main.__hmrId = "e27fe13d"
typeof __VUE_HMR_RUNTIME__ !== 'undefined' && __VUE_HMR_RUNTIME__.createRecord(_sfc_main.__hmrId, _sfc_main)
import.meta.hot.accept(mod=>{
    if (!mod)
        return
    const {default: updated, _rerender_only} = mod
    if (_rerender_only) {
        __VUE_HMR_RUNTIME__.rerender(updated.__hmrId, updated.render)
    } else {
        __VUE_HMR_RUNTIME__.reload(updated.__hmrId, updated)
    }
}
)
import _export_sfc from '/_nuxt/@id/__x00__plugin-vue:export-helper'
export default /*#__PURE__*/
_export_sfc(_sfc_main, [['render', _sfc_render], ['__file', "/home/jzerpa/workspace/machine_learning/tasksmanager/src/components/Prueba.vue"]])
// sourceMappingURL=data:application/json;base64, ...
```