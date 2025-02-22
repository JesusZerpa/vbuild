import { dirname, resolve, basename, extname, relative, normalize, isAbsolute, join } from 'pathe';
import { createHooks, createDebugger } from 'hookable';
import { useNuxt, resolveFiles, defineNuxtModule, addPlugin, addTemplate, addComponent, updateTemplates, addVitePlugin, addWebpackPlugin, findPath, isIgnored, resolveAlias, addPluginTemplate, logger, resolvePath, nuxtCtx, tryResolveModule, installModule, loadNuxtConfig, normalizeTemplate, compileTemplate, normalizePlugin, templateUtils, importModule } from '@nuxt/kit';
import escapeRE from 'escape-string-regexp';
import fse from 'fs-extra';
import { encodePath, parseURL, stringifyQuery, parseQuery, joinURL, withTrailingSlash, withoutLeadingSlash } from 'ufo';
import { existsSync, readdirSync, statSync, promises } from 'node:fs';
import { genArrayFromRaw, genSafeVariableName, genImport, genDynamicImport, genObjectFromRawEntries, genString, genExport } from 'knitwork';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kebabCase, splitByCase, pascalCase, camelCase } from 'scule';
import { createUnplugin } from 'unplugin';
import { findStaticImports, findExports, parseStaticImport, resolvePath as resolvePath$1 } from 'mlly';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import { globby } from 'globby';
import { hyphenate } from '@vue/shared';
import { parse, walk as walk$1, ELEMENT_NODE } from 'ultrahtml';
import { defineUnimportPreset, createUnimport, toImports, scanDirExports } from 'unimport';
import { createRequire } from 'node:module';
import { createTransformer } from 'unctx/transform';
import { stripLiteral } from 'strip-literal';
import { createNitro, scanHandlers, writeTypes, build as build$1, prepare, copyPublicAssets, prerender, createDevServer } from 'nitropack';
import defu from 'defu';
import { dynamicEventHandler } from 'h3';
import { createHeadCore } from 'unhead';
import { renderSSRHead } from '@unhead/ssr';
import chokidar from 'chokidar';
import { debounce } from 'perfect-debounce';
import { generateTypes, resolveSchema } from 'untyped';
import { hash } from 'ohash';

let _distDir = dirname(fileURLToPath(import.meta.url));
if (_distDir.match(/(chunks|shared)$/)) {
  _distDir = dirname(_distDir);
}
const distDir = _distDir;
const pkgDir = resolve(distDir, "..");
resolve(distDir, "runtime");

function getNameFromPath(path) {
  return kebabCase(basename(path).replace(extname(path), "")).replace(/["']/g, "");
}
function uniqueBy(arr, key) {
  const res = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of arr) {
    if (seen.has(item[key])) {
      continue;
    }
    seen.add(item[key]);
    res.push(item);
  }
  return res;
}
function hasSuffix(path, suffix) {
  return basename(path).replace(extname(path), "").endsWith(suffix);
}

async function resolvePagesRoutes() {
  const nuxt = useNuxt();
  const pagesDirs = nuxt.options._layers.map(
    (layer) => resolve(layer.config.srcDir, layer.config.dir?.pages || "pages")
  );
  const allRoutes = (await Promise.all(
    pagesDirs.map(async (dir) => {
      const files = await resolveFiles(dir, `**/*{${nuxt.options.extensions.join(",")}}`);
      files.sort();
      return generateRoutesFromFiles(files, dir);
    })
  )).flat();
  return uniqueBy(allRoutes, "path");
}
function generateRoutesFromFiles(files, pagesDir) {
  const routes = [];
  for (const file of files) {
    const segments = relative(pagesDir, file).replace(new RegExp(`${escapeRE(extname(file))}$`), "").split("/");
    const route = {
      name: "",
      path: "",
      file,
      children: []
    };
    let parent = routes;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const tokens = parseSegment(segment);
      const segmentName = tokens.map(({ value }) => value).join("");
      route.name += (route.name && "-") + segmentName;
      const child = parent.find((parentRoute) => parentRoute.name === route.name && !parentRoute.path.endsWith("(.*)*"));
      if (child && child.children) {
        parent = child.children;
        route.path = "";
      } else if (segmentName === "index" && !route.path) {
        route.path += "/";
      } else if (segmentName !== "index") {
        route.path += getRoutePath(tokens);
      }
    }
    parent.push(route);
  }
  return prepareRoutes(routes);
}
function getRoutePath(tokens) {
  return tokens.reduce((path, token) => {
    return path + (token.type === 2 /* optional */ ? `:${token.value}?` : token.type === 1 /* dynamic */ ? `:${token.value}` : token.type === 3 /* catchall */ ? `:${token.value}(.*)*` : encodePath(token.value));
  }, "/");
}
const PARAM_CHAR_RE = /[\w\d_.]/;
function parseSegment(segment) {
  let state = 0 /* initial */;
  let i = 0;
  let buffer = "";
  const tokens = [];
  function consumeBuffer() {
    if (!buffer) {
      return;
    }
    if (state === 0 /* initial */) {
      throw new Error("wrong state");
    }
    tokens.push({
      type: state === 1 /* static */ ? 0 /* static */ : state === 2 /* dynamic */ ? 1 /* dynamic */ : state === 3 /* optional */ ? 2 /* optional */ : 3 /* catchall */,
      value: buffer
    });
    buffer = "";
  }
  while (i < segment.length) {
    const c = segment[i];
    switch (state) {
      case 0 /* initial */:
        buffer = "";
        if (c === "[") {
          state = 2 /* dynamic */;
        } else {
          i--;
          state = 1 /* static */;
        }
        break;
      case 1 /* static */:
        if (c === "[") {
          consumeBuffer();
          state = 2 /* dynamic */;
        } else {
          buffer += c;
        }
        break;
      case 4 /* catchall */:
      case 2 /* dynamic */:
      case 3 /* optional */:
        if (buffer === "...") {
          buffer = "";
          state = 4 /* catchall */;
        }
        if (c === "[" && state === 2 /* dynamic */) {
          state = 3 /* optional */;
        }
        if (c === "]" && (state !== 3 /* optional */ || buffer[buffer.length - 1] === "]")) {
          if (!buffer) {
            throw new Error("Empty param");
          } else {
            consumeBuffer();
          }
          state = 0 /* initial */;
        } else if (PARAM_CHAR_RE.test(c)) {
          buffer += c;
        } else ;
        break;
    }
    i++;
  }
  if (state === 2 /* dynamic */) {
    throw new Error(`Unfinished param "${buffer}"`);
  }
  consumeBuffer();
  return tokens;
}
function prepareRoutes(routes, parent) {
  for (const route of routes) {
    if (route.name) {
      route.name = route.name.replace(/-index$/, "");
    }
    if (parent && route.path.startsWith("/")) {
      route.path = route.path.slice(1);
    }
    if (route.children?.length) {
      route.children = prepareRoutes(route.children, route);
    }
    if (route.children?.find((childRoute) => childRoute.path === "")) {
      delete route.name;
    }
  }
  return routes;
}
function normalizeRoutes(routes, metaImports = /* @__PURE__ */ new Set()) {
  return {
    imports: metaImports,
    routes: genArrayFromRaw(routes.map((route) => {
      const file = normalize(route.file);
      const metaImportName = genSafeVariableName(file) + "Meta";
      metaImports.add(genImport(`${file}?macro=true`, [{ name: "default", as: metaImportName }]));
      let aliasCode = `${metaImportName}?.alias || []`;
      if (Array.isArray(route.alias) && route.alias.length) {
        aliasCode = `${JSON.stringify(route.alias)}.concat(${aliasCode})`;
      }
      return {
        ...Object.fromEntries(Object.entries(route).map(([key, value]) => [key, JSON.stringify(value)])),
        name: `${metaImportName}?.name ?? ${route.name ? JSON.stringify(route.name) : "undefined"}`,
        path: `${metaImportName}?.path ?? ${JSON.stringify(route.path)}`,
        children: route.children ? normalizeRoutes(route.children, metaImports).routes : [],
        meta: route.meta ? `{...(${metaImportName} || {}), ...${JSON.stringify(route.meta)}}` : metaImportName,
        alias: aliasCode,
        redirect: route.redirect ? JSON.stringify(route.redirect) : `${metaImportName}?.redirect || undefined`,
        component: genDynamicImport(file, { interopDefault: true })
      };
    }))
  };
}

const CODE_EMPTY = `
const __nuxt_page_meta = {}
export default __nuxt_page_meta
`;
const CODE_HMR = `
// Vite
if (import.meta.hot) {
  import.meta.hot.accept(mod => {
    Object.assign(__nuxt_page_meta, mod)
  })
}
// Webpack
if (import.meta.webpackHot) {
  import.meta.webpackHot.accept((err) => {
    if (err) { window.location = window.location.href }
  })
}`;
const PageMetaPlugin = createUnplugin((options) => {
  return {
    name: "nuxt:pages-macros-transform",
    enforce: "post",
    transformInclude(id) {
     
      const query = parseMacroQuery(id);
      id = normalize(id);
      const isPagesDir = options.dirs.some((dir) => typeof dir === "string" ? id.startsWith(dir) : dir.test(id));
      if (!isPagesDir && !query.macro) {
        return false;
      }
      const { pathname } = parseURL(decodeURIComponent(pathToFileURL(id).href));

      return /\.(m?[jt]sx?|vue)/.test(pathname);
    },
    transform(code, id) {
      if (id.includes("python")){
        console.log("zzzzzzzzz",id)

      }
      
      const query = parseMacroQuery(id);
      if (query.type && query.type !== "script") {
        return;
      }
      console.log("hhhhhhhh")
      const s = new MagicString(code);
      console.log("yyyyyyy")
      function result() {
        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
          };
        }
      }

      const hasMacro = code.match(/\bdefinePageMeta\s*\(\s*/);
      if (!query.macro) {
        if (hasMacro) {


          walk(this.parse(code, {
            sourceType: "module",
            ecmaVersion: "latest"
          }), {
            enter(_node) {
              if (_node.type !== "CallExpression" || _node.callee.type !== "Identifier") {
                return;
              }
              const node = _node;
              const name = "name" in node.callee && node.callee.name;
              if (name === "definePageMeta") {
                s.overwrite(node.start, node.end, "false && {}");
              }
            }
          });
        }
        return result();
      }
      console.log("aaaaaaaaaaaaaaaa")
      const imports = findStaticImports(code);
      const scriptImport = imports.find((i) => parseMacroQuery(i.specifier).type === "script");
      if (scriptImport) {
        const specifier = rewriteQuery(scriptImport.specifier);
        s.overwrite(0, code.length, `export { default } from ${JSON.stringify(specifier)}`);
        return result();
      }
      const currentExports = findExports(code);
      for (const match of currentExports) {
        if (match.type !== "default" || !match.specifier) {
          continue;
        }
        const specifier = rewriteQuery(match.specifier);
        s.overwrite(0, code.length, `export { default } from ${JSON.stringify(specifier)}`);
        return result();
      }
      if (!hasMacro && !code.includes("export { default }") && !code.includes("__nuxt_page_meta")) {
        s.overwrite(0, code.length, CODE_EMPTY + (options.dev ? CODE_HMR : ""));
        return result();
      }

      const importMap = /* @__PURE__ */ new Map();
      const addedImports = /* @__PURE__ */ new Set();
      for (const i of imports) {
        const parsed = parseStaticImport(i);
        for (const name of [
          parsed.defaultImport,
          ...Object.keys(parsed.namedImports || {}),
          parsed.namespacedImport
        ].filter(Boolean)) {
          importMap.set(name, i);
        }
      }
      if (query["lang.python"]==undefined){

      
      walk(this.parse(code, {
        sourceType: "module",
        ecmaVersion: "latest"
      }), {
        enter(_node) {
          if (_node.type !== "CallExpression" || _node.callee.type !== "Identifier") {
            return;
          }
          const node = _node;
          const name = "name" in node.callee && node.callee.name;
          if (name !== "definePageMeta") {
            return;
          }
          const meta = node.arguments[0];
          let contents = `const __nuxt_page_meta = ${code.slice(meta.start, meta.end) || "{}"}
export default __nuxt_page_meta` + (options.dev ? CODE_HMR : "");
          function addImport(name2) {
            if (name2 && importMap.has(name2)) {
              const importValue = importMap.get(name2).code;
              if (!addedImports.has(importValue)) {
                contents = importMap.get(name2).code + "\n" + contents;
                addedImports.add(importValue);
              }
            }
          }
          walk(meta, {
            enter(_node2) {
              if (_node2.type === "CallExpression") {
                const node2 = _node2;
                addImport("name" in node2.callee && node2.callee.name);
              }
              if (_node2.type === "Identifier") {
                const node2 = _node2;
                addImport(node2.name);
              }
            }
          });
          s.overwrite(0, code.length, contents);
        }
      });
      }

      if (!s.hasChanged() && !code.includes("__nuxt_page_meta")) {
        s.overwrite(0, code.length, CODE_EMPTY + (options.dev ? CODE_HMR : ""));
      }
      console.log("jjjjjjjj")
      return result();
    },
    vite: {
      handleHotUpdate: {
        order: "pre",
        handler: ({ modules }) => {
          const index = modules.findIndex((i) => i.id?.includes("?macro=true"));
          if (index !== -1) {
            modules.splice(index, 1);
          }
        }
      }
    }
  };
});
function rewriteQuery(id) {
  const query = stringifyQuery({ macro: "true", ...parseMacroQuery(id) });
  return id.replace(/\?.+$/, "?" + query);
}
function parseMacroQuery(id) {
  const { search } = parseURL(decodeURIComponent(isAbsolute(id) ? pathToFileURL(id).href : id).replace(/\?macro=true$/, ""));
  const query = parseQuery(search);
  if (id.includes("?macro=true")) {
    return { macro: "true", ...query };
  }
  return query;
}

const pagesModule = defineNuxtModule({
  meta: {
    name: "pages"
  },
  setup(_options, nuxt) {
    const pagesDirs = nuxt.options._layers.map(
      (layer) => resolve(layer.config.srcDir, layer.config.dir?.pages || "pages")
    );
    const isNonEmptyDir = (dir) => existsSync(dir) && readdirSync(dir).length;
    const isPagesEnabled = () => {
      if (typeof nuxt.options.pages === "boolean") {
        return nuxt.options.pages;
      }
      if (nuxt.options._layers.some((layer) => existsSync(resolve(layer.config.srcDir, "app/router.options.ts")))) {
        return true;
      }
      if (pagesDirs.some((dir) => isNonEmptyDir(dir))) {
        return true;
      }
      return false;
    };
    nuxt.options.pages = isPagesEnabled();
    if (!nuxt.options.pages) {
      addPlugin(resolve(distDir, "app/plugins/router"));
      addTemplate({
        filename: "pages.mjs",
        getContents: () => "export { useRoute } from '#app'"
      });
      addComponent({
        name: "NuxtPage",
        filePath: resolve(distDir, "pages/runtime/page-placeholder")
      });
      return;
    }
    const runtimeDir = resolve(distDir, "pages/runtime");
    nuxt.hook("prepare:types", ({ references }) => {
      references.push({ types: "vue-router" });
    });
    nuxt.hook("imports:sources", (sources) => {
      const routerImports = sources.find((s) => s.from === "#app" && s.imports.includes("onBeforeRouteLeave"));
      if (routerImports) {
        routerImports.from = "vue-router";
      }
    });
    nuxt.hook("builder:watch", async (event, path) => {
      const dirs = [
        nuxt.options.dir.pages,
        nuxt.options.dir.layouts,
        nuxt.options.dir.middleware
      ].filter(Boolean);
      const pathPattern = new RegExp(`(^|\\/)(${dirs.map(escapeRE).join("|")})/`);
      if (event !== "change" && path.match(pathPattern)) {
        await updateTemplates({
          filter: (template) => template.filename === "routes.mjs"
        });
      }
    });
    nuxt.hook("app:resolve", (app) => {
      if (app.mainComponent.includes("@nuxt/ui-templates")) {
        app.mainComponent = resolve(runtimeDir, "app.vue");
      }
      app.middleware.unshift({
        name: "validate",
        path: resolve(runtimeDir, "validate"),
        global: true
      });
    });
    if (!nuxt.options.dev && nuxt.options._generate) {
      const prerenderRoutes = /* @__PURE__ */ new Set();
      nuxt.hook("modules:done", () => {
        nuxt.hook("pages:extend", (pages) => {
          prerenderRoutes.clear();
          const processPages = (pages2, currentPath = "/") => {
            for (const page of pages2) {
              if (page.path.match(/^\/?:.*(\?|\(\.\*\)\*)$/) && !page.children?.length) {
                prerenderRoutes.add(currentPath);
              }
              if (page.path.includes(":")) {
                continue;
              }
              const route = joinURL(currentPath, page.path);
              prerenderRoutes.add(route);
              if (page.children) {
                processPages(page.children, route);
              }
            }
          };
          processPages(pages);
        });
      });
      nuxt.hook("nitro:build:before", (nitro) => {
        for (const route of nitro.options.prerender.routes || []) {
          if (route === "/") {
            continue;
          }
          prerenderRoutes.add(route);
        }
        nitro.options.prerender.routes = Array.from(prerenderRoutes);
      });
    }
    nuxt.hook("imports:extend", (imports) => {
      imports.push(
        { name: "definePageMeta", as: "definePageMeta", from: resolve(runtimeDir, "composables") },
        { name: "useLink", as: "useLink", from: "vue-router" }
      );
    });
    const pageMetaOptions = {
      dev: nuxt.options.dev,
      sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client,
      dirs: nuxt.options._layers.map(
        (layer) => resolve(layer.config.srcDir, layer.config.dir?.pages || "pages")
      )
    };
    addVitePlugin(PageMetaPlugin.vite(pageMetaOptions));
    addWebpackPlugin(PageMetaPlugin.webpack(pageMetaOptions));
    addPlugin(resolve(runtimeDir, "router"));
    const getSources = (pages) => pages.flatMap(
      (p) => [relative(nuxt.options.srcDir, p.file), ...getSources(p.children || [])]
    );
    nuxt.hook("build:manifest", async (manifest) => {
      const pages = await resolvePagesRoutes();
      await nuxt.callHook("pages:extend", pages);
      const sourceFiles = getSources(pages);
      for (const key in manifest) {
        if (manifest[key].isEntry) {
          manifest[key].dynamicImports = manifest[key].dynamicImports?.filter((i) => !sourceFiles.includes(i));
        }
      }
    });
    addTemplate({
      filename: "routes.mjs",
      async getContents() {
        const pages = await resolvePagesRoutes();
        await nuxt.callHook("pages:extend", pages);
        const { routes, imports } = normalizeRoutes(pages);
        return [...imports, `export default ${routes}`].join("\n");
      }
    });
    addTemplate({
      filename: "pages.mjs",
      getContents: () => "export { useRoute } from 'vue-router'"
    });
    nuxt.options.vite.optimizeDeps = nuxt.options.vite.optimizeDeps || {};
    nuxt.options.vite.optimizeDeps.include = nuxt.options.vite.optimizeDeps.include || [];
    nuxt.options.vite.optimizeDeps.include.push("vue-router");
    addTemplate({
      filename: "router.options.mjs",
      getContents: async () => {
        const routerOptionsFiles = (await Promise.all(nuxt.options._layers.map(
          async (layer) => await findPath(resolve(layer.config.srcDir, "app/router.options"))
        ))).filter(Boolean);
        routerOptionsFiles.push(resolve(runtimeDir, "router.options"));
        const configRouterOptions = genObjectFromRawEntries(Object.entries(nuxt.options.router.options).map(([key, value]) => [key, genString(value)]));
        return [
          ...routerOptionsFiles.map((file, index) => genImport(file, `routerOptions${index}`)),
          `const configRouterOptions = ${configRouterOptions}`,
          "export default {",
          "...configRouterOptions,",
          ...routerOptionsFiles.map((_, index) => `...routerOptions${index},`).reverse(),
          "}"
        ].join("\n");
      }
    });
    addTemplate({
      filename: "types/middleware.d.ts",
      getContents: ({ app }) => {
        const composablesFile = resolve(runtimeDir, "composables");
        const namedMiddleware = app.middleware.filter((mw) => !mw.global);
        return [
          "import type { NavigationGuard } from 'vue-router'",
          `export type MiddlewareKey = ${namedMiddleware.map((mw) => genString(mw.name)).join(" | ") || "string"}`,
          `declare module ${genString(composablesFile)} {`,
          "  interface PageMeta {",
          "    middleware?: MiddlewareKey | NavigationGuard | Array<MiddlewareKey | NavigationGuard>",
          "  }",
          "}"
        ].join("\n");
      }
    });
    addTemplate({
      filename: "types/layouts.d.ts",
      getContents: ({ app }) => {
        const composablesFile = resolve(runtimeDir, "composables");
        return [
          "import { ComputedRef, Ref } from 'vue'",
          `export type LayoutKey = ${Object.keys(app.layouts).map((name) => genString(name)).join(" | ") || "string"}`,
          `declare module ${genString(composablesFile)} {`,
          "  interface PageMeta {",
          "    layout?: false | LayoutKey | Ref<LayoutKey> | ComputedRef<LayoutKey>",
          "  }",
          "}"
        ].join("\n");
      }
    });
    addComponent({
      name: "NuxtPage",
      filePath: resolve(distDir, "pages/runtime/page")
    });
    nuxt.hook("prepare:types", ({ references }) => {
      references.push({ path: resolve(nuxt.options.buildDir, "types/middleware.d.ts") });
      references.push({ path: resolve(nuxt.options.buildDir, "types/layouts.d.ts") });
    });
  }
});

const components = ["NoScript", "Link", "Base", "Title", "Meta", "Style", "Head", "Html", "Body"];
const metaModule = defineNuxtModule({
  meta: {
    name: "meta"
  },
  setup(options, nuxt) {
    const runtimeDir = nuxt.options.alias["#head"] || resolve(distDir, "head/runtime");
    nuxt.options.build.transpile.push("@vueuse/head");
    nuxt.options.alias["#head"] = runtimeDir;
    const componentsPath = resolve(runtimeDir, "components");
    for (const componentName of components) {
      addComponent({
        name: componentName,
        filePath: componentsPath,
        export: componentName,
        kebabName: componentName
      });
    }
    addPlugin({ src: resolve(runtimeDir, "lib/vueuse-head.plugin") });
  }
});

const createImportMagicComments = (options) => {
  const { chunkName, prefetch, preload } = options;
  return [
    `webpackChunkName: "${chunkName}"`,
    prefetch === true || typeof prefetch === "number" ? `webpackPrefetch: ${prefetch}` : false,
    preload === true || typeof preload === "number" ? `webpackPreload: ${preload}` : false
  ].filter(Boolean).join(", ");
};
const componentsPluginTemplate = {
  filename: "components.plugin.mjs",
  getContents({ options }) {
    const globalComponents = options.getComponents().filter((c) => c.global === true);
    return `import { defineAsyncComponent } from 'vue'
import { defineNuxtPlugin } from '#app'

const components = ${genObjectFromRawEntries(globalComponents.map((c) => {
      const exp = c.export === "default" ? "c.default || c" : `c['${c.export}']`;
      const comment = createImportMagicComments(c);
      return [c.pascalName, `defineAsyncComponent(${genDynamicImport(c.filePath, { comment })}.then(c => ${exp}))`];
    }))}

export default defineNuxtPlugin(nuxtApp => {
  for (const name in components) {
    nuxtApp.vueApp.component(name, components[name])
    nuxtApp.vueApp.component('Lazy' + name, components[name])
  }
})
`;
  }
};
const componentsTemplate = {
  getContents({ options }) {
    const imports = /* @__PURE__ */ new Set();
    imports.add("import { defineAsyncComponent } from 'vue'");
    let num = 0;
    const components = options.getComponents(options.mode).flatMap((c) => {
      const exp = c.export === "default" ? "c.default || c" : `c['${c.export}']`;
      const comment = createImportMagicComments(c);
      const isClient = c.mode === "client";
      const definitions = [];
      if (isClient) {
        num++;
        const identifier = `__nuxt_component_${num}`;
        imports.add(genImport("#app/components/client-only", [{ name: "createClientOnly" }]));
        imports.add(genImport(c.filePath, [{ name: c.export, as: identifier }]));
        definitions.push(`export const ${c.pascalName} =  /*#__PURE__*/  createClientOnly(${identifier})`);
      } else {
        definitions.push(genExport(c.filePath, [{ name: c.export, as: c.pascalName }]));
      }
      definitions.push(`export const Lazy${c.pascalName} = defineAsyncComponent(${genDynamicImport(c.filePath, { comment })}.then(c => ${isClient ? `createClientOnly(${exp})` : exp}))`);
      return definitions;
    });
    return [
      ...imports,
      ...components,
      `export const componentNames = ${JSON.stringify(options.getComponents().map((c) => c.pascalName))}`
    ].join("\n");
  }
};
const componentsTypeTemplate = {
  filename: "components.d.ts",
  getContents: ({ options, nuxt }) => {
    const buildDir = nuxt.options.buildDir;
    const componentTypes = options.getComponents().map((c) => [
      c.pascalName,
      `typeof ${genDynamicImport(isAbsolute(c.filePath) ? relative(buildDir, c.filePath).replace(/(?<=\w)\.(?!vue)\w+$/g, "") : c.filePath.replace(/(?<=\w)\.(?!vue)\w+$/g, ""), { wrapper: false })}['${c.export}']`
    ]);
    return `// Generated by components discovery
declare module '@vue/runtime-core' {
  export interface GlobalComponents {
${componentTypes.map(([pascalName, type]) => `    '${pascalName}': ${type}`).join("\n")}
${componentTypes.map(([pascalName, type]) => `    'Lazy${pascalName}': ${type}`).join("\n")}
  }
}

${componentTypes.map(([pascalName, type]) => `export const ${pascalName}: ${type}`).join("\n")}
${componentTypes.map(([pascalName, type]) => `export const Lazy${pascalName}: ${type}`).join("\n")}

export const componentNames: string[]
`;
  }
};

async function scanComponents(dirs, srcDir) {
  const components = [];
  const filePaths = /* @__PURE__ */ new Set();
  const scannedPaths = [];
  for (const dir of dirs) {
    const resolvedNames = /* @__PURE__ */ new Map();
    const files = (await globby(dir.pattern, { cwd: dir.path, ignore: dir.ignore })).sort();
    for (const _file of files) {
      const filePath = join(dir.path, _file);
      if (scannedPaths.find((d) => filePath.startsWith(withTrailingSlash(d))) || isIgnored(filePath)) {
        continue;
      }
      if (filePaths.has(filePath)) {
        continue;
      }
      filePaths.add(filePath);
      const prefixParts = [].concat(
        dir.prefix ? splitByCase(dir.prefix) : [],
        dir.pathPrefix !== false ? splitByCase(relative(dir.path, dirname(filePath))) : []
      );
      let fileName = basename(filePath, extname(filePath));
      const global = /\.(global)$/.test(fileName) || dir.global;
      const mode = fileName.match(/(?<=\.)(client|server)(\.global)?$/)?.[1] || "all";
      fileName = fileName.replace(/(\.(client|server))?(\.global)?$/, "");
      if (fileName.toLowerCase() === "index") {
        fileName = dir.pathPrefix === false ? basename(dirname(filePath)) : "";
      }
      const fileNameParts = splitByCase(fileName);
      const componentNameParts = [];
      while (prefixParts.length && (prefixParts[0] || "").toLowerCase() !== (fileNameParts[0] || "").toLowerCase()) {
        componentNameParts.push(prefixParts.shift());
      }
      const componentName = pascalCase(componentNameParts) + pascalCase(fileNameParts);
      const suffix = mode !== "all" ? `-${mode}` : "";
      if (resolvedNames.has(componentName + suffix) || resolvedNames.has(componentName)) {
        console.warn(
          `Two component files resolving to the same name \`${componentName}\`:

 - ${filePath}
 - ${resolvedNames.get(componentName)}`
        );
        continue;
      }
      resolvedNames.set(componentName + suffix, filePath);
      const pascalName = pascalCase(componentName).replace(/["']/g, "");
      const kebabName = hyphenate(componentName);
      const shortPath = relative(srcDir, filePath);
      const chunkName = "components/" + kebabName + suffix;
      let component = {
        mode,
        global,
        prefetch: Boolean(dir.prefetch),
        preload: Boolean(dir.preload),
        filePath,
        pascalName,
        kebabName,
        chunkName,
        shortPath,
        export: "default"
      };
      if (typeof dir.extendComponent === "function") {
        component = await dir.extendComponent(component) || component;
      }
      if (!components.some((c) => c.pascalName === component.pascalName && ["all", component.mode].includes(c.mode))) {
        components.push(component);
      }
    }
    scannedPaths.push(dir.path);
  }
  return components;
}

function isVueTemplate(id) {
  if (id.endsWith(".vue")) {
    return true;
  }
  const { search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
  if (!search) {
    return false;
  }
  const query = parseQuery(search);
  if (query.macro) {
    return true;
  }
  if (!("vue" in query) || query.type === "style") {
    return false;
  }
  return true;
}
const loaderPlugin = createUnplugin((options) => {
  const exclude = options.transform?.exclude || [];
  const include = options.transform?.include || [];
  return {
    name: "nuxt:components-loader",
    enforce: "post",
    transformInclude(id) {
      if (exclude.some((pattern) => id.match(pattern))) {
        return false;
      }
      if (include.some((pattern) => id.match(pattern))) {
        return true;
      }
      return isVueTemplate(id);
    },
    transform(code, id) {
      const components = options.getComponents();
      let num = 0;
      const imports = /* @__PURE__ */ new Set();
      const map = /* @__PURE__ */ new Map();
      const s = new MagicString(code);
      s.replace(/(?<=[ (])_?resolveComponent\(\s*["'](lazy-|Lazy)?([^'"]*?)["'][\s,]*[^)]*\)/g, (full, lazy, name) => {
        const component = findComponent(components, name, options.mode);
        if (component) {
          let identifier = map.get(component) || `__nuxt_component_${num++}`;
          map.set(component, identifier);
          const isClientOnly = component.mode === "client";
          if (isClientOnly) {
            imports.add(genImport("#app/components/client-only", [{ name: "createClientOnly" }]));
            identifier += "_client";
          }
          if (lazy) {
            imports.add(genImport("vue", [{ name: "defineAsyncComponent", as: "__defineAsyncComponent" }]));
            identifier += "_lazy";
            imports.add(`const ${identifier} = /*#__PURE__*/ __defineAsyncComponent(${genDynamicImport(component.filePath, { interopDefault: true })}${isClientOnly ? ".then(c => createClientOnly(c))" : ""})`);
          } else {
            imports.add(genImport(component.filePath, [{ name: component.export, as: identifier }]));
            if (isClientOnly) {
              imports.add(`const ${identifier}_wrapped = /*#__PURE__*/ createClientOnly(${identifier})`);
              identifier += "_wrapped";
            }
          }
          return identifier;
        }
        return full;
      });
      if (imports.size) {
        s.prepend([...imports, ""].join("\n"));
      }
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  };
});
function findComponent(components, name, mode) {
  const id = pascalCase(name).replace(/["']/g, "");
  const component = components.find((component2) => id === component2.pascalName && ["all", mode, void 0].includes(component2.mode));
  if (!component && components.some((component2) => id === component2.pascalName)) {
    return components.find((component2) => component2.pascalName === "ServerPlaceholder");
  }
  return component;
}

const PLACEHOLDER_RE = /^(v-slot|#)(fallback|placeholder)/;
const TreeShakeTemplatePlugin = createUnplugin((options) => {
  const regexpMap = /* @__PURE__ */ new WeakMap();
  return {
    name: "nuxt:tree-shake-template",
    enforce: "pre",
    transformInclude(id) {
      const { pathname } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      return pathname.endsWith(".vue");
    },
    async transform(code, id) {
      const template = code.match(/<template>([\s\S]*)<\/template>/);
      if (!template) {
        return;
      }
      const components = options.getComponents();
      if (!regexpMap.has(components)) {
        const clientOnlyComponents2 = components.filter((c) => c.mode === "client" && !components.some((other) => other.mode !== "client" && other.pascalName === c.pascalName)).flatMap((c) => [c.pascalName, c.kebabName]).concat(["ClientOnly", "client-only"]);
        const tags = clientOnlyComponents2.map((component) => `<(${component})[^>]*>[\\s\\S]*?<\\/(${component})>`);
        regexpMap.set(components, [new RegExp(`(${tags.join("|")})`, "g"), clientOnlyComponents2]);
      }
      const [COMPONENTS_RE, clientOnlyComponents] = regexpMap.get(components);
      if (!COMPONENTS_RE.test(code)) {
        return;
      }
      const s = new MagicString(code);
      const ast = parse(template[0]);
      await walk$1(ast, (node) => {
        if (node.type !== ELEMENT_NODE || !clientOnlyComponents.includes(node.name) || !node.children?.length) {
          return;
        }
        const fallback = node.children.find(
          (n) => n.name === "template" && Object.entries(n.attributes)?.flat().some((attr) => PLACEHOLDER_RE.test(attr))
        );
        try {
          const text = fallback ? code.slice(template.index + fallback.loc[0].start, template.index + fallback.loc[fallback.loc.length - 1].end) : "";
          s.overwrite(template.index + node.loc[0].end, template.index + node.loc[node.loc.length - 1].start, text);
        } catch (err) {
        }
      });
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  };
});

const isPureObjectOrString = (val) => !Array.isArray(val) && typeof val === "object" || typeof val === "string";
const isDirectory = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch (_e) {
    return false;
  }
};
function compareDirByPathLength({ path: pathA }, { path: pathB }) {
  return pathB.split(/[\\/]/).filter(Boolean).length - pathA.split(/[\\/]/).filter(Boolean).length;
}
const DEFAULT_COMPONENTS_DIRS_RE = /\/components$|\/components\/global$/;
const componentsModule = defineNuxtModule({
  meta: {
    name: "components",
    configKey: "components"
  },
  defaults: {
    dirs: []
  },
  setup(componentOptions, nuxt) {
    let componentDirs = [];
    const context = {
      components: []
    };
    const getComponents = (mode) => {
      return mode && mode !== "all" ? context.components.filter((c) => c.mode === mode || c.mode === "all") : context.components;
    };
    const normalizeDirs = (dir, cwd) => {
      if (Array.isArray(dir)) {
        return dir.map((dir2) => normalizeDirs(dir2, cwd)).flat().sort(compareDirByPathLength);
      }
      if (dir === true || dir === void 0) {
        return [
          { path: resolve(cwd, "components/global"), global: true },
          { path: resolve(cwd, "components") }
        ];
      }
      if (typeof dir === "string") {
        return [
          { path: resolve(cwd, resolveAlias(dir)) }
        ];
      }
      if (!dir) {
        return [];
      }
      const dirs = (dir.dirs || [dir]).map((dir2) => typeof dir2 === "string" ? { path: dir2 } : dir2).filter((_dir) => _dir.path);
      return dirs.map((_dir) => ({
        ..._dir,
        path: resolve(cwd, resolveAlias(_dir.path))
      }));
    };
    nuxt.hook("app:resolve", async () => {
      const allDirs = nuxt.options._layers.map((layer) => normalizeDirs(layer.config.components, layer.config.srcDir)).flat();
      await nuxt.callHook("components:dirs", allDirs);
      componentDirs = allDirs.filter(isPureObjectOrString).map((dir) => {
        const dirOptions = typeof dir === "object" ? dir : { path: dir };
        const dirPath = resolveAlias(dirOptions.path);
        const transpile = typeof dirOptions.transpile === "boolean" ? dirOptions.transpile : "auto";
        const extensions = (dirOptions.extensions || nuxt.options.extensions).map((e) => e.replace(/^\./g, ""));
        const present = isDirectory(dirPath);
        if (!present && !DEFAULT_COMPONENTS_DIRS_RE.test(dirOptions.path)) {
          console.warn("Components directory not found: `" + dirPath + "`");
        }
        return {
          global: componentOptions.global,
          ...dirOptions,
          enabled: true,
          path: dirPath,
          extensions,
          pattern: dirOptions.pattern || `**/*.{${extensions.join(",")},}`,
          ignore: [
            "**/*{M,.m,-m}ixin.{js,ts,jsx,tsx}",
            "**/*.d.ts",
            ...dirOptions.ignore || []
          ],
          transpile: transpile === "auto" ? dirPath.includes("node_modules") : transpile
        };
      }).filter((d) => d.enabled);
      componentDirs = [
        ...componentDirs.filter((dir) => !dir.path.includes("node_modules")),
        ...componentDirs.filter((dir) => dir.path.includes("node_modules"))
      ];
      nuxt.options.build.transpile.push(...componentDirs.filter((dir) => dir.transpile).map((dir) => dir.path));
    });
    addTemplate({ ...componentsTypeTemplate, options: { getComponents } });
    addPluginTemplate({ ...componentsPluginTemplate, options: { getComponents } });
    addTemplate({ ...componentsTemplate, filename: "components.server.mjs", options: { getComponents, mode: "server" } });
    addTemplate({ ...componentsTemplate, filename: "components.client.mjs", options: { getComponents, mode: "client" } });
    nuxt.hook("vite:extendConfig", (config, { isClient }) => {
      const mode = isClient ? "client" : "server";
      config.resolve.alias["#components"] = resolve(nuxt.options.buildDir, `components.${mode}.mjs`);
    });
    nuxt.hook("webpack:config", (configs) => {
      for (const config of configs) {
        const mode = config.name === "server" ? "server" : "client";
        config.resolve.alias["#components"] = resolve(nuxt.options.buildDir, `components.${mode}.mjs`);
      }
    });
    nuxt.hook("build:manifest", (manifest) => {
      const sourceFiles = getComponents().filter((c) => c.global).map((c) => relative(nuxt.options.srcDir, c.filePath));
      for (const key in manifest) {
        if (manifest[key].isEntry) {
          manifest[key].dynamicImports = manifest[key].dynamicImports?.filter((i) => !sourceFiles.includes(i));
        }
      }
    });
    nuxt.hook("app:templates", async () => {
      const newComponents = await scanComponents(componentDirs, nuxt.options.srcDir);
      await nuxt.callHook("components:extend", newComponents);
      for (const component of newComponents) {
        if (component.mode === "client" && !newComponents.some((c) => c.pascalName === component.pascalName && c.mode === "server")) {
          newComponents.push({
            ...component,
            mode: "server",
            filePath: resolve(distDir, "app/components/server-placeholder"),
            chunkName: "components/" + component.kebabName
          });
        }
      }
      context.components = newComponents;
    });
    nuxt.hook("prepare:types", ({ references, tsConfig }) => {
      tsConfig.compilerOptions.paths["#components"] = [relative(nuxt.options.rootDir, resolve(nuxt.options.buildDir, "components"))];
      references.push({ path: resolve(nuxt.options.buildDir, "components.d.ts") });
    });
    nuxt.hook("builder:watch", async (event, path) => {
      if (!["add", "unlink"].includes(event)) {
        return;
      }
      const fPath = resolve(nuxt.options.srcDir, path);
      if (componentDirs.find((dir) => fPath.startsWith(dir.path))) {
        await updateTemplates({
          filter: (template) => [
            "components.plugin.mjs",
            "components.d.ts",
            "components.server.mjs",
            "components.client.mjs"
          ].includes(template.filename)
        });
      }
    });
    nuxt.hook("vite:extendConfig", (config, { isClient, isServer }) => {
      const mode = isClient ? "client" : "server";
      config.plugins = config.plugins || [];
      config.plugins.push(loaderPlugin.vite({
        sourcemap: nuxt.options.sourcemap[mode],
        getComponents,
        mode
      }));
      if (nuxt.options.experimental.treeshakeClientOnly && isServer) {
        config.plugins.push(TreeShakeTemplatePlugin.vite({
          sourcemap: nuxt.options.sourcemap[mode],
          getComponents
        }));
      }
    });
    nuxt.hook("webpack:config", (configs) => {
      configs.forEach((config) => {
        const mode = config.name === "client" ? "client" : "server";
        config.plugins = config.plugins || [];
        config.plugins.push(loaderPlugin.webpack({
          sourcemap: nuxt.options.sourcemap[mode],
          getComponents,
          mode
        }));
        if (nuxt.options.experimental.treeshakeClientOnly && mode === "server") {
          config.plugins.push(TreeShakeTemplatePlugin.webpack({
            sourcemap: nuxt.options.sourcemap[mode],
            getComponents
          }));
        }
      });
    });
  }
});

const TransformPlugin = createUnplugin(({ ctx, options, sourcemap }) => {
  return {
    name: "nuxt:imports-transform",
    enforce: "post",
    transformInclude(id) {
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const query = parseQuery(search);
      if (options.transform?.include?.some((pattern) => id.match(pattern))) {
        return true;
      }
      if (options.transform?.exclude?.some((pattern) => id.match(pattern))) {
        return false;
      }
      if (id.endsWith(".vue") || "macro" in query || "vue" in query && (query.type === "template" || query.type === "script" || "setup" in query)) {
        return true;
      }
      if (pathname.match(/\.((c|m)?j|t)sx?$/g)) {
        return true;
      }
    },
    async transform(code, id) {
      id = normalize(id);
      const isNodeModule = id.match(/[\\/]node_modules[\\/]/) && !options.transform?.include?.some((pattern) => id.match(pattern));
      if (isNodeModule && !code.match(/(['"])#imports\1/)) {
        return;
      }
      const { s } = await ctx.injectImports(code, id, { autoImport: options.autoImport && !isNodeModule });
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  };
});

const commonPresets = [
  defineUnimportPreset({
    from: "#head",
    imports: [
      "useHead"
    ]
  }),
  defineUnimportPreset({
    from: "vue-demi",
    imports: [
      "isVue2",
      "isVue3"
    ]
  })
];
const appPreset = defineUnimportPreset({
  from: "#app",
  imports: [
    "useAsyncData",
    "useLazyAsyncData",
    "refreshNuxtData",
    "clearNuxtData",
    "defineNuxtComponent",
    "useNuxtApp",
    "defineNuxtPlugin",
    "useRuntimeConfig",
    "useState",
    "useFetch",
    "useLazyFetch",
    "useCookie",
    "useRequestHeaders",
    "useRequestEvent",
    "setResponseStatus",
    "setPageLayout",
    "useRouter",
    "useRoute",
    "useActiveRoute",
    "defineNuxtRouteMiddleware",
    "navigateTo",
    "abortNavigation",
    "addRouteMiddleware",
    "throwError",
    "showError",
    "clearError",
    "isNuxtError",
    "useError",
    "createError",
    "defineNuxtLink",
    "useAppConfig",
    "updateAppConfig",
    "defineAppConfig",
    "preloadComponents",
    "preloadRouteComponents",
    "prefetchComponents",
    "loadPayload",
    "preloadPayload",
    "isPrerendered"
  ]
});
const routerPreset = defineUnimportPreset({
  from: "#app",
  imports: [
    "onBeforeRouteLeave",
    "onBeforeRouteUpdate"
  ]
});
const vuePreset = defineUnimportPreset({
  from: "vue",
  imports: [
    "withCtx",
    "withDirectives",
    "withKeys",
    "withMemo",
    "withModifiers",
    "withScopeId",
    "onActivated",
    "onBeforeMount",
    "onBeforeUnmount",
    "onBeforeUpdate",
    "onDeactivated",
    "onErrorCaptured",
    "onMounted",
    "onRenderTracked",
    "onRenderTriggered",
    "onServerPrefetch",
    "onUnmounted",
    "onUpdated",
    "computed",
    "customRef",
    "isProxy",
    "isReactive",
    "isReadonly",
    "isRef",
    "markRaw",
    "proxyRefs",
    "reactive",
    "readonly",
    "ref",
    "shallowReactive",
    "shallowReadonly",
    "shallowRef",
    "toRaw",
    "toRef",
    "toRefs",
    "triggerRef",
    "unref",
    "watch",
    "watchEffect",
    "isShallow",
    "effect",
    "effectScope",
    "getCurrentScope",
    "onScopeDispose",
    "defineComponent",
    "defineAsyncComponent",
    "resolveComponent",
    "getCurrentInstance",
    "h",
    "inject",
    "nextTick",
    "provide",
    "useAttrs",
    "useCssModule",
    "useCssVars",
    "useSlots",
    "useTransitionState"
  ]
});
const defaultPresets = [
  ...commonPresets,
  appPreset,
  routerPreset,
  vuePreset
];

const importsModule = defineNuxtModule({
  meta: {
    name: "imports",
    configKey: "imports"
  },
  defaults: {
    autoImport: true,
    presets: defaultPresets,
    global: false,
    imports: [],
    dirs: [],
    transform: {
      include: [],
      exclude: void 0
    }
  },
  async setup(options, nuxt) {
    const presets = JSON.parse(JSON.stringify(options.presets));
    await nuxt.callHook("imports:sources", presets);
    const ctx = createUnimport({
      presets,
      imports: options.imports,
      virtualImports: ["#imports"],
      addons: {
        vueTemplate: options.autoImport
      }
    });
    let composablesDirs = [];
    for (const layer of nuxt.options._layers) {
      composablesDirs.push(resolve(layer.config.srcDir, "composables"));
      composablesDirs.push(resolve(layer.config.srcDir, "utils"));
      for (const dir of layer.config.imports?.dirs ?? []) {
        if (!dir) {
          continue;
        }
        composablesDirs.push(resolve(layer.config.srcDir, dir));
      }
    }
    await nuxt.callHook("imports:dirs", composablesDirs);
    composablesDirs = composablesDirs.map((dir) => normalize(dir));
    addTemplate({
      filename: "imports.mjs",
      getContents: async () => await ctx.toExports() + '\nif (process.dev) { console.warn("[nuxt] `#imports` should be transformed with real imports. There seems to be something wrong with the imports plugin.") }'
    });
    nuxt.options.alias["#imports"] = join(nuxt.options.buildDir, "imports");
    if (nuxt.options.dev && options.global) {
      addPluginTemplate({
        filename: "imports.mjs",
        getContents: async () => {
          const imports = await ctx.getImports();
          const importStatement = toImports(imports);
          const globalThisSet = imports.map((i) => `globalThis.${i.as} = ${i.as};`).join("\n");
          return `${importStatement}

${globalThisSet}

export default () => {};`;
        }
      });
    } else {
      addVitePlugin(TransformPlugin.vite({ ctx, options, sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
      addWebpackPlugin(TransformPlugin.webpack({ ctx, options, sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
    }
    const regenerateImports = async () => {
      ctx.clearDynamicImports();
      await ctx.modifyDynamicImports(async (imports) => {
        imports.push(...await scanDirExports(composablesDirs));
        await nuxt.callHook("imports:extend", imports);
      });
    };
    await regenerateImports();
    addDeclarationTemplates(ctx, options);
    nuxt.hook("prepare:types", ({ references }) => {
      references.push({ path: resolve(nuxt.options.buildDir, "types/imports.d.ts") });
      references.push({ path: resolve(nuxt.options.buildDir, "imports.d.ts") });
    });
    const templates = [
      "types/imports.d.ts",
      "imports.d.ts",
      "imports.mjs"
    ];
    nuxt.hook("builder:watch", async (_, path) => {
      const _resolved = resolve(nuxt.options.srcDir, path);
      if (composablesDirs.find((dir) => _resolved.startsWith(dir))) {
        await updateTemplates({
          filter: (template) => templates.includes(template.filename)
        });
      }
    });
    nuxt.hook("builder:generateApp", async () => {
      await regenerateImports();
    });
  }
});
function addDeclarationTemplates(ctx, options) {
  const nuxt = useNuxt();
  const stripExtension = (path) => path.replace(/\.[a-z]+$/, "");
  const resolved = {};
  const r = ({ from }) => {
    if (resolved[from]) {
      return resolved[from];
    }
    let path = resolveAlias(from);
    if (isAbsolute(path)) {
      path = relative(join(nuxt.options.buildDir, "types"), path);
    }
    path = stripExtension(path);
    resolved[from] = path;
    return path;
  };
  addTemplate({
    filename: "imports.d.ts",
    getContents: () => ctx.toExports(nuxt.options.buildDir)
  });
  addTemplate({
    filename: "types/imports.d.ts",
    getContents: async () => "// Generated by auto imports\n" + (options.autoImport ? await ctx.generateTypeDeclarations({ resolvePath: r }) : "// Implicit auto importing is disabled, you can use explicitly import from `#imports` instead.")
  });
}

const version = "3.0.0-rc.14";

const _require = createRequire(import.meta.url);
const vueAppPatterns = (nuxt) => [
  [/^(nuxt3|nuxt)$/, "`nuxt3`/`nuxt` cannot be imported directly. Instead, import runtime Nuxt composables from `#app` or `#imports`."],
  [/^((|~|~~|@|@@)\/)?nuxt\.config(\.|$)/, "Importing directly from a `nuxt.config` file is not allowed. Instead, use runtime config or a module."],
  [/(^|node_modules\/)@vue\/composition-api/],
  ...nuxt.options.modules.filter((m) => typeof m === "string").map((m) => [new RegExp(`^${escapeRE(m)}$`), "Importing directly from module entry points is not allowed."]),
  ...[/(^|node_modules\/)@nuxt\/kit/, /^nitropack/].map((i) => [i, "This module cannot be imported in the Vue part of your app."]),
  [new RegExp(escapeRE(join(nuxt.options.srcDir, nuxt.options.dir.server || "server")) + "\\/(api|routes|middleware|plugins)\\/"), "Importing from server is not allowed in the Vue part of your app."]
];
const ImportProtectionPlugin = createUnplugin(function(options) {
  const cache = {};
  const importersToExclude = options?.exclude || [];
  return {
    name: "nuxt:import-protection",
    enforce: "pre",
    resolveId(id, importer) {
      if (!importer) {
        return;
      }
      if (id.startsWith(".")) {
        id = join(importer, "..", id);
      }
      if (isAbsolute(id)) {
        id = relative(options.rootDir, id);
      }
      if (importersToExclude.some((p) => typeof p === "string" ? importer === p : p.test(importer))) {
        return;
      }
      const invalidImports = options.patterns.filter(([pattern]) => pattern instanceof RegExp ? pattern.test(id) : pattern === id);
      let matched = false;
      for (const match of invalidImports) {
        cache[id] = cache[id] || /* @__PURE__ */ new Map();
        const [pattern, warning] = match;
        if (cache[id].has(pattern)) {
          continue;
        }
        const relativeImporter = isAbsolute(importer) ? relative(options.rootDir, importer) : importer;
        logger.error(warning || "Invalid import", `[importing \`${id}\` from \`${relativeImporter}\`]`);
        cache[id].set(pattern, true);
        matched = true;
      }
      if (matched) {
        return _require.resolve("unenv/runtime/mock/proxy");
      }
      return null;
    }
  };
});

const UnctxTransformPlugin = (nuxt) => {
  const transformer = createTransformer({
    asyncFunctions: ["defineNuxtPlugin", "defineNuxtRouteMiddleware"]
  });
  let app;
  nuxt.hook("app:resolve", (_app) => {
    app = _app;
  });
  return createUnplugin((options = {}) => ({
    name: "unctx:transfrom",
    enforce: "post",
    transformInclude(id) {
      id = normalize(id).replace(/\?.*$/, "");
      return app?.plugins.some((i) => i.src === id) || app?.middleware.some((m) => m.path === id);
    },
    transform(code, id) {
      const result = transformer.transform(code);
      if (result) {
        return {
          code: result.code,
          map: options.sourcemap ? result.magicString.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  }));
};

const TreeShakePlugin = createUnplugin((options) => {
  const COMPOSABLE_RE = new RegExp(`($\\s+)(${options.treeShake.join("|")})(?=\\()`, "gm");
  return {
    name: "nuxt:server-treeshake:transfrom",
    enforce: "post",
    transformInclude(id) {
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const { type } = parseQuery(search);
      if (pathname.endsWith(".vue") && (type === "script" || !search)) {
        return true;
      }
      if (pathname.match(/\.((c|m)?j|t)sx?$/g)) {
        return true;
      }
    },
    transform(code, id) {
      if (!code.match(COMPOSABLE_RE)) {
        return;
      }
      const s = new MagicString(code);
      const strippedCode = stripLiteral(code);
      for (const match of strippedCode.matchAll(COMPOSABLE_RE) || []) {
        s.overwrite(match.index, match.index + match[0].length, `${match[1]} /*#__PURE__*/ false && ${match[2]}`);
      }
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  };
});

const DevOnlyPlugin = createUnplugin((options) => {
  const DEVONLY_COMP_RE = /<dev-?only>(:?[\s\S]*)<\/dev-?only>/gmi;
  return {
    name: "nuxt:server-devonly:transfrom",
    enforce: "pre",
    transformInclude(id) {
      const { pathname, search } = parseURL(decodeURIComponent(pathToFileURL(id).href));
      const { type } = parseQuery(search);
      if (pathname.endsWith(".vue") && (type === "template" || !search)) {
        return true;
      }
    },
    transform(code, id) {
      if (!code.match(DEVONLY_COMP_RE)) {
        return;
      }
      const s = new MagicString(code);
      const strippedCode = stripLiteral(code);
      for (const match of strippedCode.matchAll(DEVONLY_COMP_RE) || []) {
        s.remove(match.index, match.index + match[0].length);
      }
      if (s.hasChanged()) {
        return {
          code: s.toString(),
          map: options.sourcemap ? s.generateMap({ source: id, includeContent: true }) : void 0
        };
      }
    }
  };
});

const addModuleTranspiles = (opts = {}) => {
  const nuxt = useNuxt();
  const modules = [
    ...opts.additionalModules || [],
    ...nuxt.options.modules,
    ...nuxt.options._modules
  ].map((m) => typeof m === "string" ? m : Array.isArray(m) ? m[0] : m.src).filter((m) => typeof m === "string").map((m) => m.split("node_modules/").pop());
  nuxt.options.build.transpile = nuxt.options.build.transpile.map((m) => typeof m === "string" ? m.split("node_modules/").pop() : m).filter((x) => !!x);
  function isTranspilePresent(mod) {
    return nuxt.options.build.transpile.some((t) => !(t instanceof Function) && (t instanceof RegExp ? t.test(mod) : new RegExp(t).test(mod)));
  }
  for (const module of modules) {
    if (!isTranspilePresent(module)) {
      nuxt.options.build.transpile.push(module);
    }
  }
};

async function initNitro(nuxt) {
  const _nitroConfig = nuxt.options.nitro || {};
  const nitroConfig = defu(_nitroConfig, {
    debug: nuxt.options.debug,
    rootDir: nuxt.options.rootDir,
    workspaceDir: nuxt.options.workspaceDir,
    srcDir: nuxt.options.serverDir,
    dev: nuxt.options.dev,
    buildDir: nuxt.options.buildDir,
    esbuild: {
      options: {
        exclude: [
          new RegExp(`node_modules\\/(?!${nuxt.options._layers.map((l) => l.cwd.match(/(?<=\/)node_modules\/(.+)$/)?.[1]).filter(Boolean).map((dir) => escapeRE(dir)).join("|")})`)
        ]
      }
    },
    analyze: nuxt.options.build.analyze && {
      template: "treemap",
      projectRoot: nuxt.options.rootDir,
      filename: join(nuxt.options.rootDir, ".nuxt/stats", "{name}.html")
    },
    scanDirs: nuxt.options._layers.map((layer) => (layer.config.serverDir || layer.config.srcDir) && resolve(layer.cwd, layer.config.serverDir || resolve(layer.config.srcDir, "server"))).filter(Boolean),
    renderer: resolve(distDir, "core/runtime/nitro/renderer"),
    errorHandler: resolve(distDir, "core/runtime/nitro/error"),
    nodeModulesDirs: nuxt.options.modulesDir,
    handlers: nuxt.options.serverHandlers,
    devHandlers: [],
    baseURL: nuxt.options.app.baseURL,
    virtual: {
      "#internal/nuxt.config.mjs": () => nuxt.vfs["#build/nuxt.config"]
    },
    routeRules: {
      "/__nuxt_error": { cache: false }
    },
    runtimeConfig: {
      ...nuxt.options.runtimeConfig,
      nitro: {
        envPrefix: "NUXT_",
        ...nuxt.options.runtimeConfig.nitro
      }
    },
    typescript: {
      generateTsConfig: false
    },
    publicAssets: [
      { dir: resolve(nuxt.options.buildDir, "dist/client") },
      ...nuxt.options._layers.map((layer) => join(layer.config.srcDir, layer.config.dir?.public || "public")).filter((dir) => existsSync(dir)).map((dir) => ({ dir }))
    ],
    prerender: {
      crawlLinks: nuxt.options._generate ?? void 0,
      routes: [].concat(nuxt.options.generate.routes).concat(nuxt.options._generate ? [nuxt.options.ssr ? "/" : "/index.html", "/200.html", "/404.html"] : [])
    },
    sourceMap: nuxt.options.sourcemap.server,
    externals: {
      inline: [
        ...nuxt.options.dev ? [] : [
          ...nuxt.options.experimental.externalVue ? [] : ["vue", "@vue/"],
          "@nuxt/",
          nuxt.options.buildDir
        ],
        "nuxt/dist",
        "nuxt3/dist",
        distDir
      ]
    },
    alias: {
      ...nuxt.options.experimental.externalVue ? {} : {
        "vue/compiler-sfc": "vue/compiler-sfc",
        "vue/server-renderer": "vue/server-renderer",
        vue: await resolvePath(`vue/dist/vue.cjs${nuxt.options.dev ? "" : ".prod"}.js`)
      },
      "estree-walker": "unenv/runtime/mock/proxy",
      "@babel/parser": "unenv/runtime/mock/proxy",
      "@vue/compiler-core": "unenv/runtime/mock/proxy",
      "@vue/compiler-dom": "unenv/runtime/mock/proxy",
      "@vue/compiler-ssr": "unenv/runtime/mock/proxy",
      "@vue/devtools-api": "vue-devtools-stub",
      "#paths": resolve(distDir, "core/runtime/nitro/paths"),
      ...nuxt.options.alias
    },
    replace: {
      "process.env.NUXT_NO_SSR": nuxt.options.ssr === false,
      "process.env.NUXT_EARLY_HINTS": nuxt.options.experimental.writeEarlyHints !== false,
      "process.env.NUXT_NO_SCRIPTS": !!nuxt.options.experimental.noScripts && !nuxt.options.dev,
      "process.env.NUXT_INLINE_STYLES": !!nuxt.options.experimental.inlineSSRStyles,
      "process.env.NUXT_PAYLOAD_EXTRACTION": !!nuxt.options.experimental.payloadExtraction,
      "process.dev": nuxt.options.dev,
      __VUE_PROD_DEVTOOLS__: false
    },
    rollupConfig: {
      plugins: []
    }
  });
  const head = createHeadCore();
  head.push(nuxt.options.app.head);
  const headChunk = await renderSSRHead(head);
  nitroConfig.virtual["#head-static"] = `export default ${JSON.stringify(headChunk)}`;
  if (!nuxt.options.ssr) {
    nitroConfig.virtual["#build/dist/server/server.mjs"] = "export default () => {}";
  }
  if (!nuxt.options.experimental.inlineSSRStyles) {
    nitroConfig.virtual["#build/dist/server/styles.mjs"] = "export default {}";
  }
  nitroConfig.rollupConfig.plugins.push(
    ImportProtectionPlugin.rollup({
      rootDir: nuxt.options.rootDir,
      patterns: [
        ...["#app", /^#build(\/|$)/].map((p) => [p, "Vue app aliases are not allowed in server routes."])
      ],
      exclude: [/core[\\/]runtime[\\/]nitro[\\/]renderer/]
    })
  );
  await nuxt.callHook("nitro:config", nitroConfig);
  const nitro = await createNitro(nitroConfig);
  nuxt._nitro = nitro;
  await nuxt.callHook("nitro:init", nitro);
  nitro.vfs = nuxt.vfs = nitro.vfs || nuxt.vfs || {};
  nuxt.hook("close", () => nitro.hooks.callHook("close"));
  nitro.hooks.hook("prerender:routes", (routes) => {
    nuxt.callHook("prerender:routes", { routes });
  });
  const devMiddlewareHandler = dynamicEventHandler();
  nitro.options.devHandlers.unshift({ handler: devMiddlewareHandler });
  nitro.options.devHandlers.push(...nuxt.options.devServerHandlers);
  nitro.options.handlers.unshift({
    route: "/__nuxt_error",
    lazy: true,
    handler: resolve(distDir, "core/runtime/nitro/renderer")
  });
  nuxt.hook("prepare:types", async (opts) => {
    if (!nuxt.options.dev) {
      await scanHandlers(nitro);
      await writeTypes(nitro);
    }
    opts.references.push({ path: resolve(nuxt.options.buildDir, "types/nitro.d.ts") });
  });
  nuxt.hook("build:done", async () => {
    await nuxt.callHook("nitro:build:before", nitro);
    if (nuxt.options.dev) {
      await build$1(nitro);
    } else {
      await prepare(nitro);
      await copyPublicAssets(nitro);
      await prerender(nitro);
      if (!nuxt.options._generate) {
        await build$1(nitro);
      } else {
        const distDir2 = resolve(nuxt.options.rootDir, "dist");
        if (!existsSync(distDir2)) {
          await promises.symlink(nitro.options.output.publicDir, distDir2, "junction").catch(() => {
          });
        }
      }
    }
  });
  if (nuxt.options.dev) {
    nuxt.hook("webpack:compile", ({ compiler }) => {
      compiler.outputFileSystem = { ...fse, join };
    });
    nuxt.hook("webpack:compiled", () => {
      nuxt.server.reload();
    });
    nuxt.hook("vite:compiled", () => {
      nuxt.server.reload();
    });
    nuxt.hook("server:devHandler", (h) => {
      devMiddlewareHandler.set(h);
    });
    nuxt.server = createDevServer(nitro);
    const waitUntilCompile = new Promise((resolve2) => nitro.hooks.hook("compiled", () => resolve2()));
    nuxt.hook("build:done", () => waitUntilCompile);
  }
}

function createNuxt(options) {
  const hooks = createHooks();
  const nuxt = {
    _version: version,
    options,
    hooks,
    callHook: hooks.callHook,
    addHooks: hooks.addHooks,
    hook: hooks.hook,
    ready: () => initNuxt(nuxt),
    close: () => Promise.resolve(hooks.callHook("close", nuxt)),
    vfs: {}
  };
  return nuxt;
}
async function initNuxt(nuxt) {
  nuxt.hooks.addHooks(nuxt.options.hooks);
  nuxtCtx.set(nuxt);
  nuxt.hook("close", () => nuxtCtx.unset());
  nuxt.hook("prepare:types", (opts) => {
    opts.references.push({ types: "nuxt" });
    opts.references.push({ path: resolve(nuxt.options.buildDir, "types/plugins.d.ts") });
    if (nuxt.options.typescript.shim) {
      opts.references.push({ path: resolve(nuxt.options.buildDir, "types/vue-shim.d.ts") });
    }
    opts.references.push({ path: resolve(nuxt.options.buildDir, "types/schema.d.ts") });
    opts.references.push({ path: resolve(nuxt.options.buildDir, "types/app.config.d.ts") });
    for (const layer of nuxt.options._layers) {
      const declaration = join(layer.cwd, "index.d.ts");
      if (fse.existsSync(declaration)) {
        opts.references.push({ path: declaration });
      }
    }
  });
  const config = {
    rootDir: nuxt.options.rootDir,
    exclude: [join(nuxt.options.rootDir, "index.html")],
    patterns: vueAppPatterns(nuxt)
  };
  addVitePlugin(ImportProtectionPlugin.vite(config));
  addWebpackPlugin(ImportProtectionPlugin.webpack(config));
  addVitePlugin(UnctxTransformPlugin(nuxt).vite({ sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
  addWebpackPlugin(UnctxTransformPlugin(nuxt).webpack({ sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
  if (!nuxt.options.dev) {
    const removeFromServer = ["onBeforeMount", "onMounted", "onBeforeUpdate", "onRenderTracked", "onRenderTriggered", "onActivated", "onDeactivated", "onBeforeUnmount"];
    const removeFromClient = ["onServerPrefetch", "onRenderTracked", "onRenderTriggered"];
    addVitePlugin(TreeShakePlugin.vite({ sourcemap: nuxt.options.sourcemap.server, treeShake: removeFromServer }), { client: false });
    addVitePlugin(TreeShakePlugin.vite({ sourcemap: nuxt.options.sourcemap.client, treeShake: removeFromClient }), { server: false });
    addWebpackPlugin(TreeShakePlugin.webpack({ sourcemap: nuxt.options.sourcemap.server, treeShake: removeFromServer }), { client: false });
    addWebpackPlugin(TreeShakePlugin.webpack({ sourcemap: nuxt.options.sourcemap.client, treeShake: removeFromClient }), { server: false });
    addVitePlugin(DevOnlyPlugin.vite({ sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
    addWebpackPlugin(DevOnlyPlugin.webpack({ sourcemap: nuxt.options.sourcemap.server || nuxt.options.sourcemap.client }));
  }
  if (nuxt.options.experimental.noScripts && !nuxt.options.dev) {
    nuxt.hook("build:manifest", async (manifest) => {
      for (const file in manifest) {
        if (manifest[file].resourceType === "script") {
          await fse.rm(resolve(nuxt.options.buildDir, "dist/client", withoutLeadingSlash(nuxt.options.app.buildAssetsDir), manifest[file].file), { force: true });
          manifest[file].file = "";
        }
      }
    });
  }
  nuxt.options.build.transpile.push(
    ...nuxt.options._layers.filter((i) => i.cwd.includes("node_modules")).map((i) => i.cwd)
  );
  await nuxt.callHook("modules:before");
  const modulesToInstall = [
    ...nuxt.options.modules,
    ...nuxt.options._modules
  ];
  addComponent({
    name: "NuxtWelcome",
    filePath: tryResolveModule("@nuxt/ui-templates/templates/welcome.vue")
  });
  addComponent({
    name: "NuxtLayout",
    filePath: resolve(nuxt.options.appDir, "components/layout")
  });
  addComponent({
    name: "NuxtErrorBoundary",
    filePath: resolve(nuxt.options.appDir, "components/nuxt-error-boundary")
  });
  addComponent({
    name: "ClientOnly",
    filePath: resolve(nuxt.options.appDir, "components/client-only")
  });
  addComponent({
    name: "DevOnly",
    filePath: resolve(nuxt.options.appDir, "components/dev-only")
  });
  addComponent({
    name: "ServerPlaceholder",
    filePath: resolve(nuxt.options.appDir, "components/server-placeholder")
  });
  addComponent({
    name: "NuxtLink",
    filePath: resolve(nuxt.options.appDir, "components/nuxt-link")
  });
  addComponent({
    name: "NuxtLoadingIndicator",
    filePath: resolve(nuxt.options.appDir, "components/nuxt-loading-indicator")
  });
  if (!nuxt.options.dev && nuxt.options.experimental.payloadExtraction) {
    addPlugin(resolve(nuxt.options.appDir, "plugins/payload.client"));
  }
  if (nuxt.options.experimental.crossOriginPrefetch) {
    addPlugin(resolve(nuxt.options.appDir, "plugins/cross-origin-prefetch.client"));
  }
  if (nuxt.options.builder === "@nuxt/webpack-builder") {
    addPlugin(resolve(nuxt.options.appDir, "plugins/preload.server"));
  }
  if (nuxt.options.debug) {
    addPlugin(resolve(nuxt.options.appDir, "plugins/debug"));
  }
  for (const m of modulesToInstall) {
    if (Array.isArray(m)) {
      await installModule(m[0], m[1]);
    } else {
      await installModule(m, {});
    }
  }
  await nuxt.callHook("modules:done");
  nuxt.options.build.transpile = nuxt.options.build.transpile.map((t) => typeof t === "string" ? normalize(t) : t);
  addModuleTranspiles();
  await initNitro(nuxt);
  await nuxt.callHook("ready", nuxt);
}
async function loadNuxt(opts) {
  const options = await loadNuxtConfig(opts);
  options.appDir = options.alias["#app"] = resolve(distDir, "app");
  options._majorVersion = 3;
  options._modules.push(pagesModule, metaModule, componentsModule);
  options._modules.push([importsModule, {
    transform: {
      include: options._layers.filter((i) => i.cwd && i.cwd.includes("node_modules")).map((i) => new RegExp(`(^|\\/)${escapeRE(i.cwd.split("node_modules/").pop())}(\\/|$)(?!node_modules\\/)`))
    }
  }]);
  options.modulesDir.push(resolve(options.workspaceDir, "node_modules"));
  options.modulesDir.push(resolve(pkgDir, "node_modules"));
  options.build.transpile.push("@nuxt/ui-templates");
  options.alias["vue-demi"] = resolve(options.appDir, "compat/vue-demi");
  options.alias["@vue/composition-api"] = resolve(options.appDir, "compat/capi");
  if (options.telemetry !== false && !process.env.NUXT_TELEMETRY_DISABLED) {
    options._modules.push("@nuxt/telemetry");
  }
  const nuxt = createNuxt(options);
  if (nuxt.options.debug) {
    createDebugger(nuxt.hooks, { tag: "nuxt" });
  }
  if (opts.ready !== false) {
    await nuxt.ready();
  }
  return nuxt;
}

const vueShim = {
  filename: "types/vue-shim.d.ts",
  getContents: () => [
    "declare module '*.vue' {",
    "  import { DefineComponent } from '@vue/runtime-core'",
    "  const component: DefineComponent<{}, {}, any>",
    "  export default component",
    "}"
  ].join("\n")
};
const appComponentTemplate = {
  filename: "app-component.mjs",
  getContents: (ctx) => genExport(ctx.app.mainComponent, ["default"])
};
const rootComponentTemplate = {
  filename: "root-component.mjs",
  getContents: (ctx) => genExport(ctx.app.rootComponent, ["default"])
};
const errorComponentTemplate = {
  filename: "error-component.mjs",
  getContents: (ctx) => genExport(ctx.app.errorComponent, ["default"])
};
const cssTemplate = {
  filename: "css.mjs",
  getContents: (ctx) => ctx.nuxt.options.css.map((i) => genImport(i)).join("\n")
};
const clientPluginTemplate = {
  filename: "plugins/client.mjs",
  getContents(ctx) {
    const clientPlugins = ctx.app.plugins.filter((p) => !p.mode || p.mode !== "server");
    const exports = [];
    const imports = [];
    for (const plugin of clientPlugins) {
      const path = relative(ctx.nuxt.options.rootDir, plugin.src);
      const variable = genSafeVariableName(path).replace(/_(45|46|47)/g, "_") + "_" + hash(path);
      exports.push(variable);
      imports.push(genImport(plugin.src, variable));
    }
    return [
      ...imports,
      `export default ${genArrayFromRaw(exports)}`
    ].join("\n");
  }
};
const serverPluginTemplate = {
  filename: "plugins/server.mjs",
  getContents(ctx) {
    const serverPlugins = ctx.app.plugins.filter((p) => !p.mode || p.mode !== "client");
    const exports = [];
    const imports = [];
    for (const plugin of serverPlugins) {
      const path = relative(ctx.nuxt.options.rootDir, plugin.src);
      const variable = genSafeVariableName(path).replace(/_(45|46|47)/g, "_") + "_" + hash(path);
      exports.push(variable);
      imports.push(genImport(plugin.src, variable));
    }
    return [
      ...imports,
      `export default ${genArrayFromRaw(exports)}`
    ].join("\n");
  }
};
const pluginsDeclaration = {
  filename: "types/plugins.d.ts",
  getContents: (ctx) => {
    const EXTENSION_RE = new RegExp(`(?<=\\w)(${ctx.nuxt.options.extensions.map((e) => escapeRE(e)).join("|")})$`, "g");
    const tsImports = ctx.app.plugins.map((p) => (isAbsolute(p.src) ? relative(join(ctx.nuxt.options.buildDir, "types"), p.src) : p.src).replace(EXTENSION_RE, ""));
    return `// Generated by Nuxt'
import type { Plugin } from '#app'

type Decorate<T extends Record<string, any>> = { [K in keyof T as K extends string ? \`$\${K}\` : never]: T[K] }

type InjectionType<A extends Plugin> = A extends Plugin<infer T> ? Decorate<T> : unknown

type NuxtAppInjections = 
  ${tsImports.map((p) => `InjectionType<typeof ${genDynamicImport(p, { wrapper: false })}.default>`).join(" &\n  ")}

declare module '#app' {
  interface NuxtApp extends NuxtAppInjections { }
}

declare module '@vue/runtime-core' {
  interface ComponentCustomProperties extends NuxtAppInjections { }
}

export { }
`;
  }
};
const adHocModules = ["router", "pages", "imports", "meta", "components"];
const schemaTemplate = {
  filename: "types/schema.d.ts",
  getContents: async ({ nuxt }) => {
    const moduleInfo = nuxt.options._installedModules.map((m) => ({
      ...m.meta || {},
      importName: m.entryPath || m.meta?.name
    })).filter((m) => m.configKey && m.name && !adHocModules.includes(m.name));
    const relativeRoot = relative(resolve(nuxt.options.buildDir, "types"), nuxt.options.rootDir);
    return [
      "import { NuxtModule } from '@nuxt/schema'",
      "declare module '@nuxt/schema' {",
      "  interface NuxtConfig {",
      ...moduleInfo.filter(Boolean).map(
        (meta) => `    [${genString(meta.configKey)}]?: typeof ${genDynamicImport(meta.importName.startsWith(".") ? "./" + join(relativeRoot, meta.importName) : meta.importName, { wrapper: false })}.default extends NuxtModule<infer O> ? Partial<O> : Record<string, any>`
      ),
      "  }",
      generateTypes(
        await resolveSchema(Object.fromEntries(Object.entries(nuxt.options.runtimeConfig).filter(([key]) => key !== "public"))),
        {
          interfaceName: "RuntimeConfig",
          addExport: false,
          addDefaults: false,
          allowExtraKeys: false,
          indentation: 2
        }
      ),
      generateTypes(
        await resolveSchema(nuxt.options.runtimeConfig.public),
        {
          interfaceName: "PublicRuntimeConfig",
          addExport: false,
          addDefaults: false,
          allowExtraKeys: false,
          indentation: 2
        }
      ),
      "}"
    ].join("\n");
  }
};
const layoutTemplate = {
  filename: "layouts.mjs",
  getContents({ app }) {
    const layoutsObject = genObjectFromRawEntries(Object.values(app.layouts).map(({ name, file }) => {
      return [name, genDynamicImport(file, { interopDefault: true })];
    }));
    return [
      `export default ${layoutsObject}`
    ].join("\n");
  }
};
const middlewareTemplate = {
  filename: "middleware.mjs",
  getContents({ app }) {
    const globalMiddleware = app.middleware.filter((mw) => mw.global);
    const namedMiddleware = app.middleware.filter((mw) => !mw.global);
    const namedMiddlewareObject = genObjectFromRawEntries(namedMiddleware.map((mw) => [mw.name, genDynamicImport(mw.path)]));
    return [
      ...globalMiddleware.map((mw) => genImport(mw.path, genSafeVariableName(mw.name))),
      `export const globalMiddleware = ${genArrayFromRaw(globalMiddleware.map((mw) => genSafeVariableName(mw.name)))}`,
      `export const namedMiddleware = ${namedMiddlewareObject}`
    ].join("\n");
  }
};
const clientConfigTemplate = {
  filename: "nitro.client.mjs",
  getContents: () => `
export const useRuntimeConfig = () => window?.__NUXT__?.config || {}
`
};
const appConfigDeclarationTemplate = {
  filename: "types/app.config.d.ts",
  getContents: ({ app, nuxt }) => {
    return `
import type { Defu } from 'defu'
${app.configs.map((id, index) => `import ${`cfg${index}`} from ${JSON.stringify(id.replace(/(?<=\w)\.\w+$/g, ""))}`).join("\n")}

declare const inlineConfig = ${JSON.stringify(nuxt.options.appConfig, null, 2)}
type ResolvedAppConfig = Defu<typeof inlineConfig, [${app.configs.map((_id, index) => `typeof cfg${index}`).join(", ")}]>

declare module '@nuxt/schema' {
  interface AppConfig extends ResolvedAppConfig { }
}
`;
  }
};
const appConfigTemplate = {
  filename: "app.config.mjs",
  write: true,
  getContents: async ({ app, nuxt }) => {
    return `
import { defuFn } from '${await _resolveId("defu")}'

const inlineConfig = ${JSON.stringify(nuxt.options.appConfig, null, 2)}

${app.configs.map((id, index) => `import ${`cfg${index}`} from ${JSON.stringify(id)}`).join("\n")}

export default defuFn(${app.configs.map((_id, index) => `cfg${index}`).concat(["inlineConfig"]).join(", ")})
`;
  }
};
const publicPathTemplate = {
  filename: "paths.mjs",
  async getContents({ nuxt }) {
    return [
      `import { joinURL } from '${await _resolveId("ufo")}'`,
      !nuxt.options.dev && "import { useRuntimeConfig } from '#internal/nitro'",
      nuxt.options.dev ? `const appConfig = ${JSON.stringify(nuxt.options.app)}` : "const appConfig = useRuntimeConfig().app",
      "export const baseURL = () => appConfig.baseURL",
      "export const buildAssetsDir = () => appConfig.buildAssetsDir",
      "export const buildAssetsURL = (...path) => joinURL(publicAssetsURL(), buildAssetsDir(), ...path)",
      "export const publicAssetsURL = (...path) => {",
      "  const publicBase = appConfig.cdnURL || appConfig.baseURL",
      "  return path.length ? joinURL(publicBase, ...path) : publicBase",
      "}",
      "if (process.client) {",
      "  globalThis.__buildAssetsURL = buildAssetsURL",
      "  globalThis.__publicAssetsURL = publicAssetsURL",
      "}"
    ].filter(Boolean).join("\n");
  }
};
const nuxtConfigTemplate = {
  filename: "nuxt.config.mjs",
  getContents: (ctx) => {
    return Object.entries(ctx.nuxt.options.app).map(([k, v]) => `export const ${camelCase("app-" + k)} = ${JSON.stringify(v)}`).join("\n\n");
  }
};
function _resolveId(id) {
  return resolvePath$1(id, {
    url: [
      global.__NUXT_PREPATHS__,
      import.meta.url,
      process.cwd(),
      global.__NUXT_PATHS__
    ]
  });
}

const defaultTemplates = {
  __proto__: null,
  vueShim: vueShim,
  appComponentTemplate: appComponentTemplate,
  rootComponentTemplate: rootComponentTemplate,
  errorComponentTemplate: errorComponentTemplate,
  cssTemplate: cssTemplate,
  clientPluginTemplate: clientPluginTemplate,
  serverPluginTemplate: serverPluginTemplate,
  pluginsDeclaration: pluginsDeclaration,
  schemaTemplate: schemaTemplate,
  layoutTemplate: layoutTemplate,
  middlewareTemplate: middlewareTemplate,
  clientConfigTemplate: clientConfigTemplate,
  appConfigDeclarationTemplate: appConfigDeclarationTemplate,
  appConfigTemplate: appConfigTemplate,
  publicPathTemplate: publicPathTemplate,
  nuxtConfigTemplate: nuxtConfigTemplate
};

function createApp(nuxt, options = {}) {
  return defu(options, {
    dir: nuxt.options.srcDir,
    extensions: nuxt.options.extensions,
    plugins: [],
    templates: []
  });
}
async function generateApp(nuxt, app, options = {}) {
  await resolveApp(nuxt, app);
  app.templates = Object.values(defaultTemplates).concat(nuxt.options.build.templates);
  await nuxt.callHook("app:templates", app);
  app.templates = app.templates.map((tmpl) => normalizeTemplate(tmpl));
  const templateContext = { utils: templateUtils, nuxt, app };
  await Promise.all(app.templates.filter((template) => !options.filter || options.filter(template)).map(async (template) => {
    const contents = await compileTemplate(template, templateContext);
    const fullPath = template.dst || resolve(nuxt.options.buildDir, template.filename);
    nuxt.vfs[fullPath] = contents;
    const aliasPath = "#build/" + template.filename.replace(/\.\w+$/, "");
    nuxt.vfs[aliasPath] = contents;
    if (process.platform === "win32") {
      nuxt.vfs[fullPath.replace(/\//g, "\\")] = contents;
    }
    if (template.write) {
      await promises.mkdir(dirname(fullPath), { recursive: true });
      await promises.writeFile(fullPath, contents, "utf8");
    }
  }));
  await nuxt.callHook("app:templatesGenerated", app);
}
async function resolveApp(nuxt, app) {
  if (!app.mainComponent) {
    app.mainComponent = await findPath(
      nuxt.options._layers.flatMap((layer) => [`${layer.config.srcDir}/App`, `${layer.config.srcDir}/app`])
    );
  }
  if (!app.mainComponent) {
    app.mainComponent = tryResolveModule("@nuxt/ui-templates/templates/welcome.vue");
  }
  if (!app.rootComponent) {
    app.rootComponent = await findPath(["~/app.root", resolve(nuxt.options.appDir, "components/nuxt-root.vue")]);
  }
  if (!app.errorComponent) {
    app.errorComponent = await findPath(["~/error"]) || resolve(nuxt.options.appDir, "components/nuxt-error-page.vue");
  }
  app.layouts = {};
  for (const config of nuxt.options._layers.map((layer) => layer.config)) {
    const layoutFiles = await resolveFiles(config.srcDir, `${config.dir?.layouts || "layouts"}/*{${nuxt.options.extensions.join(",")}}`);
    for (const file of layoutFiles) {
      const name = getNameFromPath(file);
      app.layouts[name] = app.layouts[name] || { name, file };
    }
  }
  app.middleware = [];
  for (const config of nuxt.options._layers.map((layer) => layer.config)) {
    const middlewareFiles = await resolveFiles(config.srcDir, `${config.dir?.middleware || "middleware"}/*{${nuxt.options.extensions.join(",")}}`);
    app.middleware.push(...middlewareFiles.map((file) => {
      const name = getNameFromPath(file);
      return { name, path: file, global: hasSuffix(file, ".global") };
    }));
  }
  app.plugins = [
    ...nuxt.options.plugins.map(normalizePlugin)
  ];
  for (const config of nuxt.options._layers.map((layer) => layer.config)) {
    app.plugins.push(...[
      ...config.plugins || [],
      ...config.srcDir ? await resolveFiles(config.srcDir, [
        `${config.dir?.plugins || "plugins"}/*.{ts,js,mjs,cjs,mts,cts}`,
        `${config.dir?.plugins || "plugins"}/*/index.*{ts,js,mjs,cjs,mts,cts}`
      ]) : []
    ].map((plugin) => normalizePlugin(plugin)));
  }
  app.middleware = uniqueBy(await resolvePaths(app.middleware, "path"), "name");
  app.plugins = uniqueBy(await resolvePaths(app.plugins, "src"), "src");
  app.configs = [];
  for (const config of nuxt.options._layers.map((layer) => layer.config)) {
    const appConfigPath = await findPath(resolve(config.srcDir, "app.config"));
    if (appConfigPath) {
      app.configs.push(appConfigPath);
    }
  }
  await nuxt.callHook("app:resolve", app);
  app.middleware = uniqueBy(await resolvePaths(app.middleware, "path"), "name");
  app.plugins = uniqueBy(await resolvePaths(app.plugins, "src"), "src");
}
function resolvePaths(items, key) {
  return Promise.all(items.map(async (item) => {
    if (!item[key]) {
      return item;
    }
    return {
      ...item,
      [key]: await resolvePath(resolveAlias(item[key]))
    };
  }));
}

async function build(nuxt) {
  const app = createApp(nuxt);
  const generateApp$1 = debounce(() => generateApp(nuxt, app), void 0, { leading: true });
  await generateApp$1();
  if (nuxt.options.dev) {
    watch(nuxt);
    nuxt.hook("builder:watch", async (event, path) => {
      if (event !== "change" && /^(app\.|error\.|plugins\/|middleware\/|layouts\/)/i.test(path)) {
        if (path.startsWith("app")) {
          app.mainComponent = void 0;
        }
        if (path.startsWith("error")) {
          app.errorComponent = void 0;
        }
        await generateApp$1();
      }
    });
    nuxt.hook("builder:generateApp", (options) => {
      if (options) {
        return generateApp(nuxt, app, options);
      }
      return generateApp$1();
    });
  }
  await nuxt.callHook("build:before");
  if (!nuxt.options._prepare) {
    await bundle(nuxt);
    await nuxt.callHook("build:done");
  }
  if (!nuxt.options.dev) {
    await nuxt.callHook("close", nuxt);
  }
}
function watch(nuxt) {
  const watcher = chokidar.watch(nuxt.options._layers.map((i) => i.config.srcDir).filter(Boolean), {
    ...nuxt.options.watchers.chokidar,
    cwd: nuxt.options.srcDir,
    ignoreInitial: true,
    ignored: [
      isIgnored,
      ".nuxt",
      "node_modules"
    ]
  });
  watcher.on("all", (event, path) => nuxt.callHook("builder:watch", event, normalize(path)));
  nuxt.hook("close", () => watcher.close());
  return watcher;
}
async function bundle(nuxt) {
  try {
    const { bundle: bundle2 } = typeof nuxt.options.builder === "string" ? await importModule(nuxt.options.builder, { paths: nuxt.options.rootDir }) : nuxt.options.builder;
    return bundle2(nuxt);
  } catch (error) {
    await nuxt.callHook("build:error", error);
    if (error.toString().includes("Cannot find module '@nuxt/webpack-builder'")) {
      throw new Error([
        "Could not load `@nuxt/webpack-builder`. You may need to add it to your project dependencies, following the steps in `https://github.com/nuxt/framework/pull/2812`."
      ].join("\n"));
    }
    throw error;
  }
}

export { build, createNuxt, loadNuxt };
