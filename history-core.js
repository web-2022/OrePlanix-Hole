(function(root){
  'use strict';
  function parseExactJSON(text){
    // Protege enteros bigint antes de JSON.parse; no transforma números dentro de cadenas.
    return JSON.parse(text.replace(/("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,(match,string,number)=>{
      if(string||!/^[-]?\d+$/.test(number))return match;
      return Number.isSafeInteger(Number(number))?number:JSON.stringify(number);
    }));
  }
  function id(value){
    const text=String(value??'');
    if(!/^[1-9]\d*$/.test(text)||BigInt(text)>9223372036854775807n)throw new Error('Identificador inválido.');
    if(typeof value==='number'&&!Number.isSafeInteger(value))throw new Error('Identificador sin precisión suficiente.');
    return text;
  }
  function page(value){
    if(!value||!Array.isArray(value.items)||typeof value.has_more!=='boolean')throw new Error('Respuesta de historial incompleta.');
    if(value.has_more&&!value.next_cursor)throw new Error('Falta el cursor de la siguiente página.');
    return value;
  }
  const api={parseExactJSON,id,page};
  if(typeof module!=='undefined')module.exports=api;else root.HistoryCore=api;
})(typeof window==='undefined'?globalThis:window);
