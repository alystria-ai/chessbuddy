import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(new URL('../../package.json',import.meta.url));const {chromium}=require('playwright'),{Chess}=require('chess.js');
const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--mute-audio'],args:['--use-angle=d3d11','--force-high-performance-gpu','--autoplay-policy=no-user-gesture-required','--auto-select-tab-capture-source-by-title=Chessbuddy','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-features=CalculateNativeWinOcclusion','--run-all-compositor-stages-before-draw']});
const alternateVideo=process.argv.includes('--alternate-video');
const context=await browser.newContext({viewport:{width:2560,height:1440},deviceScaleFactor:1,permissions:['microphone'],...(alternateVideo?{recordVideo:{dir:root+'/capture/alternate',size:{width:2560,height:1440}}}:{})});
if(process.argv.includes('--replay'))await context.addInitScript(()=>localStorage.setItem('demo-replay','1'));
const page=await context.newPage();let events=[],take,lastTake,takeExtension='mp4';
await page.exposeFunction('__demoEvent',async(name,data)=>{events.push({name,nodeTime:Date.now(),...data});if(name==='calibration'){await page.mouse.move(1000,1200);await page.screenshot({path:root+'/capture/'+take+'-calibration.png'});}});await page.addInitScript({path:root+'/browser-capture.js'});
const style=async()=>page.addStyleTag({content:(await readFile(root+'/recording-layout.css','utf8')).replace(/(^|\n)(\.[^{]+)\{/g,(_,line,selectors)=>line+selectors.split(',').map(s=>'html body #root#root '+s.trim()).join(',')+'{')});
await page.goto('http://127.0.0.1:5188/',{waitUntil:'domcontentloaded'});await style();
async function click(l){await l.waitFor({state:'visible'});const b=await l.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18});await page.waitForTimeout(180);await l.click();}
createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const a=JSON.parse(raw||'{}');let result={ok:true};
if(req.url==='/status')result=await page.evaluate(()=>({text:document.body.innerText,buttons:[...document.querySelectorAll('button')].map(b=>({text:b.innerText,label:b.getAttribute('aria-label'),disabled:b.disabled})),canvas:[...document.querySelectorAll('canvas')].map(c=>({width:c.width,height:c.height})),state:document.querySelector('.game-screen')?.dataset.screenState}));
else if(req.url==='/click')await click(a.selector?page.locator(a.selector).first():page.getByRole('button',{name:a.name,exact:true}).first());
else if(req.url==='/pointer')await page.mouse.move(a.x,a.y,{steps:20});
else if(req.url==='/type'){const l=page.getByRole('textbox',{name:a.name});await click(l);await l.pressSequentially(a.text,{delay:43});}
else if(req.url==='/record'){take=a.name;lastTake=take;takeExtension=a.format==='webm'?'webm':'mp4';events=[];await page.evaluate(format=>window.__demoStartRecording(format),a.format);}
else if(req.url==='/stop'){const b=await page.evaluate(()=>window.__demoStopRecording());await writeFile(root+'/capture/'+take+'.'+takeExtension,Buffer.from(b,'base64'));await writeFile(root+'/capture/'+take+'-events.json',JSON.stringify(events,null,2));result={take,format:takeExtension};take=null;}
else if(req.url==='/mark')events.push({name:a.name,nodeTime:Date.now()});
else if(req.url==='/eval')result=await page.evaluate(a.code);
else if(req.url==='/mha-start')result=await page.evaluate(()=>window.__demoBeginMha());
else if(req.url==='/mha-save'){
const data=await page.evaluate(()=>window.__demoEndMha());
const start=events.find(e=>e.name==='record-start').browserTime;
data.frames=data.frames.map(f=>({t:f.t+(data.origin-start)/1000,v:f.v}));
await writeFile(root+'/capture/'+a.name+'-mha.json',JSON.stringify(data));result={frames:data.frames.length};}
else if(req.url==='/screen'){await page.screenshot({path:root+'/capture/'+a.name+'.png'});}
else if(req.url==='/rects')result=await page.evaluate(()=>Object.fromEntries(['.character-window','.coach-chat-row','.chess-board',...['g5','e4','c5','d5','c3'].map(s=>`.chess-board button[aria-label^="${s}"]`)].map(s=>{const r=document.querySelector(s)?.getBoundingClientRect();return[s,r?{x:r.x,y:r.y,w:r.width,h:r.height}:null];})));
else if(req.url==='/prepare'){
const lines={leila:'d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 exd5 Bd3 Bb7 O-O Nbd7 Rc1 c5 Bb1 Re8 Qc2 Nf8 Rfd1 Rc8',sofia:'e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6 Bb3 Ba7 Nbd2 h6 Nf1 Be6 Ng3 Qd7',magnus:'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7 g4 b5',arjun:'d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7 Be3 f5 f3 f4 Bf2 g5'};
if(a.lines)Object.assign(lines,a.lines);
const sessions=Object.entries(lines).map(([coachId,line])=>{const g=new Chess(),moves=[];for(const san of line.split(' ')){const before=g.fen(),m=g.move(san);moves.push({san:m.san,from:m.from,to:m.to,piece:m.piece,captured:m.captured,color:m.color,by:m.color==='w'?'You':coachId,fenBefore:before,fenAfter:g.fen()});}return{id:'demo-'+coachId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),mode:'quick-play',coachId,difficultyId:'intermediate',result:'In progress',finalFen:g.fen(),hintsUsed:0,moves};});
await page.evaluate(({sessions,coach,replay})=>{localStorage.setItem('demo-replay',replay?'1':'0');localStorage.setItem('classic-chess.sessions.v1',JSON.stringify(sessions));localStorage.setItem('chessbuddy-ready-preferences-v1',JSON.stringify({coachId:coach,difficultyId:'intermediate'}));},{sessions,coach:a.coach,replay:a.replay});await page.reload({waitUntil:'domcontentloaded'});await style();}
else if(req.url==='/close'){await context.close();if(alternateVideo&&lastTake)await page.video().saveAs(root+'/capture/'+lastTake+'-visual.webm');await browser.close();process.exitCode=0;setTimeout(()=>process.exit(),200);}
else throw Error('Unknown route');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}}).listen(8797,'127.0.0.1',()=>console.log('CAPTURE_READY'));
