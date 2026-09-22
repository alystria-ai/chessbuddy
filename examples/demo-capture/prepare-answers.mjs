import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../package.json',import.meta.url));const {Chess}=require('chess.js');
const call=async(path,data={})=>{const r=await fetch('http://127.0.0.1:8797/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const x=await r.json();if(!r.ok)throw Error(x.error);return x;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(test,label){const end=Date.now()+120000;while(Date.now()<end){const s=await call('status');if(test(s))return s;await delay(200);}throw Error(label+' timed out');}
const legal='e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6';
const italian='e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 Nbd2 h6 Nf1 Be6 Ng3 Qd7 h3 Bxb3';
const g=new Chess();for(const m of (legal+' Nxe5 Bxd1 Bxf7+ Ke7 Nd5#').split(' '))g.move(m);if(!g.isCheckmate())throw Error('Invalid tactic');
const context='Verified legal teaching variation: after 1 e4 e5 2 Nf3 d6 3 Bc4 Bg4 4 Nc3 g6, White can play Nxe5. If Black greedily plays Bxd1, then Bxf7+ forces Ke7 and Nd5 is checkmate. Taking the queen is NOT forced or best defense. If Black instead plays dxe5, White can capture the bishop on g4 with Qxg4; White trades a knight for a bishop and pawn, NOT a forced mate. Explain only the line relevant to the student question in two or three clear, natural sentences. Do not enumerate notation without explaining what the pieces do. Do not claim Bxd1 is forced.';
export const questions=[
 {id:'leila-pin',coach:'leila',line:legal,q:'My knight looks pinned to the queen. Is there a way to exploit that?',context},
 {id:'leila-mate',coach:'leila',line:legal,q:'If you take my queen, how do the bishop and knight finish the attack?',context},
 {id:'leila-decline',coach:'leila',line:legal,q:'What if you ignore my queen and take the knight with your pawn?',context},
 {id:'sofia-recapture',coach:'sofia',line:italian,q:'Your bishop just took mine on b3. Should I recapture or keep attacking?',context:'The black bishop from e6 has just captured the white bishop on b3. White to move: axb3 is legal, restores material balance, and opens the a file for the white rook a1. Explain the immediate loose piece before plans for an attack, in two natural sentences.'},
 {id:'sofia-file',coach:'sofia',line:italian+' axb3 Rfe8',q:'What changed for my rook after that recapture?',context:'White has just played axb3, Black Rfe8. The white a-pawn moved from a2 to b3 capturing the bishop. The a file is now SEMI-OPEN, not fully open, because Black still has a pawn on a6. The white rook a1 has a clear line toward that pawn. White accepted doubled b-pawns in exchange for rook activity. Explain this tradeoff in two natural sentences without claiming a forced win or a fully open file.'},
 {id:'sofia-habit',coach:'sofia',line:italian+' axb3 Rfe8',q:'I tend to rush attacks. What should I check before each move?',context:'Give a practical pre-move habit: opponent checks, captures and threats, then undefended own pieces. Refer to the just-seen need to recapture the bishop as an example. Two or three helpful natural sentences.'},
];
await writeFile('edit/questions-v11.json',JSON.stringify(questions,null,2));
const selected=process.argv.slice(2);
for(const q of questions.filter(q=>!selected.length||selected.includes(q.id))){
 await call('prepare',{coach:q.coach,lines:{[q.coach]:q.line},replay:false});await call('click',{name:'Open game library'});
 await call('click',{selector:`.games-list button:has-text("${q.coach[0].toUpperCase()+q.coach.slice(1)}")`});await call('click',{name:'Resume game'});
 await until(s=>s.canvas.length&&!s.text.includes('LOADING')&&s.text.includes('Your move — choose a piece.'),'ready');await delay(1000);
 await call('eval',{code:`(()=>{const m=window.__demoManager;const original=m.sendUserChat.bind(m);m.sendUserChat=(...a)=>{a[3]+='\\n'+${JSON.stringify(q.context)};return original(...a);};return true;})()`});
 await call('record',{name:q.id+'-source'});await call('mha-start');
 await call('type',{name:'Ask '+q.coach[0].toUpperCase()+q.coach.slice(1),text:q.q});await call('click',{name:'Send message'});await call('pointer',{x:990,y:1260});
 await until(s=>s.text.includes('is speaking'),'speech');await call('mark',{name:'speech-start'});
 const result=await until(s=>s.text.includes('Your move — choose a piece.'),'done');await call('mark',{name:'speech-end'});await delay(700);
 const text=await call('eval',{code:`window.__demoManager.pool.get(${JSON.stringify(q.coach)}).longestResponseText`});
 await writeFile('capture/'+q.id+'-reply.json',JSON.stringify({...q,text},null,2));console.log(q.id,text);
 console.log(await call('mha-save',{name:q.id}));await call('stop');
}
