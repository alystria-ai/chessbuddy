import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const call=async(path,data={})=>{const r=await fetch('http://127.0.0.1:8797/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const body=await r.text();if(!r.ok)throw Error(body);return body?JSON.parse(body):null;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const qs=[...JSON.parse(await readFile('edit/questions-v11.json','utf8')),...JSON.parse(await readFile('edit/questions-v13-extra.json','utf8'))];
async function until(test,label){const end=Date.now()+90000;while(Date.now()<end){const s=await call('status');if(test(s))return s;await delay(150);}throw Error(label+' timed out');}
async function narrate(id){await call('mark',{name:'narration:'+id});const n=+execFileSync(process.env.FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1','audio/v15-'+id+'.wav'],{encoding:'utf8'});await delay(n*1000+400);}
async function question(id){const q=qs.find(q=>q.id===id);await call('mark',{name:'typing-start:'+id});await call('type',{name:'Ask '+q.coach[0].toUpperCase()+q.coach.slice(1),text:q.q});await call('mark',{name:'typing-end:'+id});await delay(400);await call('click',{name:'Send message'});await call('pointer',{x:990,y:1240});await until(s=>s.text.includes('is speaking'),'reply start');await until(s=>s.text.includes('Your move — choose a piece.'),'reply end');await delay(650);}
async function move(from,to){await call('click',{selector:`.chess-board button[aria-label^="${from}"]`});await call('click',{selector:`.chess-board button[aria-label^="${to}"]`});await call('pointer',{x:990,y:1240});}
const coach=process.argv[2];if(!['leila','sofia','magnus','arjun'].includes(coach))throw Error('Supply one coach per capture controller');
const first=qs.find(q=>q.coach===coach);
await call('prepare',{coach,lines:first?{[coach]:first.line}:{},replay:true});
await call('click',{name:'Open game library'});await call('click',{selector:`.games-list button:has-text("${coach[0].toUpperCase()+coach.slice(1)}")`});await call('click',{name:'Resume game'});
await until(s=>s.canvas.length&&!s.text.includes('LOADING')&&s.text.includes('Your move — choose a piece.'),'ready');await delay(4000);
await call('eval',{code:`(()=>{window.__demoBlackMoves=${JSON.stringify(coach==='leila'?['Bxd1','Ke7']:coach==='sofia'?['Rfe8']:[])};window.__demoMoveReplies=${JSON.stringify(coach==='sofia'?['sofia-move']:[])};return true;})()`});
await writeFile('capture/v15-'+coach+'-rects.json',JSON.stringify(await call('rects'),null,2));
await call('record',{name:'v15-'+coach,format:'webm'});await call('mark',{name:'scene-in'});
if(coach==='leila'){
 await call('eval',{code:`window.__demoPlayReply('leila-pin')`});await delay(500);
 await narrate('intro');await question('leila-mate');await question('leila-decline');
 await narrate('trap');await call('mark',{name:'tactic-start'});await move('f3','e5');await delay(2600);await move('c4','f7');await delay(2600);await move('c3','d5');
 await until(s=>s.buttons.some(b=>b.text.includes('View Analysis')),'result popup');await delay(1600);await call('screen',{name:'v15-result-popup'});
 await call('click',{name:'View Analysis'});await call('pointer',{x:990,y:1240});await delay(800);await until(s=>!s.text.includes('LOADING'),'analysis character ready');await call('mark',{name:'analysis-open'});await narrate('review');await call('screen',{name:'v15-analysis'});await delay(1000);
}else if(coach==='sofia'){
 await narrate('context');await call('mark',{name:'automatic-move-reaction'});await move('a2','b3');
 await until(s=>s.text.includes('is speaking'),'automatic move reply start');await until(s=>s.text.includes('Your move — choose a piece.'),'automatic move reply end');await delay(700);
 await narrate('reaction');await question('sofia-file');await narrate('vision');await narrate('memory');await question('sofia-favourite');
}else if(coach==='magnus'){
 await call('click',{selector:'.chess-board button[aria-label^="d2"]'});await call('pointer',{x:990,y:1240});await narrate('coaches');
}else{
 await call('click',{selector:'.chess-board button[aria-label^="e3"]'});await call('pointer',{x:990,y:1240});await delay(500);await call('mark',{name:'closing'});await narrate('outro');await delay(1600);
}
await call('screen',{name:'v15-'+coach+'-end'});console.log(await call('stop'));await call('close');
