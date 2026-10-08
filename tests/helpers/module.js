const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(filename, substitutes = {}) {
  const module = { exports: {} }, requireReal = createRequire(filename);
  const wrapper = vm.runInThisContext(`(function(require,module,exports,__filename,__dirname){${fs.readFileSync(filename,'utf8')}\n})`, {filename});
  wrapper(name => Object.hasOwn(substitutes,name) ? substitutes[name] : requireReal(name), module, module.exports, filename, require('node:path').dirname(filename));
  return module.exports;
}
module.exports = { load };
