const assert=require('node:assert/strict');const core=require('../history-core.js');
const result=core.parseExactJSON('{"batch_id":9223372036854775807,"cursor":{"before_id":9007199254740993},"file_name":"ID 9223372036854775807 <img onerror=x>","small":42,"decimal":1.25}');
assert.equal(result.batch_id,'9223372036854775807');assert.equal(result.cursor.before_id,'9007199254740993');assert.equal(result.file_name,'ID 9223372036854775807 <img onerror=x>');assert.equal(result.small,42);assert.equal(result.decimal,1.25);
assert.equal(core.id(result.batch_id),'9223372036854775807');assert.throws(()=>core.id(9007199254740993));assert.throws(()=>core.id('9223372036854775808'));assert.throws(()=>core.id('-1'));
assert.throws(()=>core.page({items:[],has_more:true,next_cursor:null}));assert.throws(()=>core.page({items:[],has_more:'false'}));
assert.deepEqual(core.page({items:[],has_more:false,next_cursor:null}).items,[]);
console.log('OK: bigint exacto, cadenas intactas, IDs inválidos y páginas incompletas rechazados.');
