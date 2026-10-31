(function(root){
 'use strict';
 function createCostRealtime({client,onRefresh,onStatus=()=>{},delay=150}){
  let current=null,target='',generation=0,operation=Promise.resolve(),token=null;
  const retire=[];
  const active=s=>current===s&&s.generation===generation;
  function schedule(s){
   if(!active(s))return;s.pending=true;if(s.running||s.timer)return;
   s.timer=setTimeout(()=>flush(s),delay);
  }
  async function flush(s){
   s.timer=null;if(!active(s))return;s.running=true;s.pending=false;
   try{await onRefresh({projectId:s.projectId,key:s.key,isCurrent:()=>active(s)});}
   catch{if(active(s))onStatus('refresh_error');}
   finally{s.running=false;if(active(s)&&s.pending)schedule(s);}
  }
  function sync(context){
   const project=String(context?.projectId??'');
   const valid=context?.identity&&context?.accessToken&&/^[1-9]\d*$/.test(project);
   const key=valid?context.identity+'|'+project:'';
   token=valid?context.accessToken:null;
   if(key!==target){
    target=key;generation++;
    if(current){clearTimeout(current.timer);retire.push(current.channel);current=null;}
   }
   const epoch=generation;
   onStatus(key?'connecting':'inactive');
   operation=operation.catch(()=>{}).then(async()=>{
    while(retire.length){const ch=retire.shift();await client.removeChannel(ch);}
    if(epoch!==generation||key!==target)return;
    if(!key){onStatus('inactive');return;}
    await client.realtime.setAuth(token);
    if(epoch!==generation||key!==target)return;
    if(current){onStatus(current.connected?'connected':'connecting');return;}
    const s={generation:epoch,key,projectId:project,pending:false,running:false,timer:null,seen:new Set(),connected:false,everConnected:false};
    const channel=client.channel('project:'+project+':updates',{config:{private:true}});s.channel=channel;current=s;
    channel.on('broadcast',{event:'data_changed'},message=>{
     const p=message?.payload;
     if(!active(s)||!p||String(p.project_id)!==project||p.module!=='COSTS'||!['INSERT','UPDATE','DELETE'].includes(p.operation))return;
     if(p.id&&s.seen.has(p.id))return;
     if(p.id){s.seen.add(p.id);if(s.seen.size>100)s.seen.delete(s.seen.values().next().value);}
     schedule(s);
    }).subscribe(status=>{
     if(!active(s))return;
     if(status==='SUBSCRIBED'){
      const reconnect=s.everConnected;s.connected=true;s.everConnected=true;onStatus('connected');if(reconnect)schedule(s);
     }else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)){s.connected=false;onStatus('reconnecting');}
    });
   }).catch(()=>{if(epoch===generation)onStatus('unavailable');});
   return operation;
  }
  return {sync,stop:()=>sync(null),settled:()=>operation};
 }
 if(typeof module!=='undefined')module.exports={createCostRealtime};else root.CostRealtime={createCostRealtime};
})(typeof window==='undefined'?globalThis:window);
