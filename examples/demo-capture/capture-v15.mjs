// One browser context per coach: closing each context finalizes its continuous video.
import {spawn} from 'node:child_process';
const coaches=process.argv.slice(2);
for(const coach of coaches.length?coaches:['leila','sofia','magnus','arjun']){
 if(!['leila','sofia','magnus','arjun'].includes(coach))throw Error('Unknown coach '+coach);
 const controller=spawn(process.execPath,['capture.mjs','--replay','--alternate-video'],{windowsHide:true,stdio:['ignore','pipe','inherit']});
 const closed=new Promise(resolve=>controller.once('exit',resolve));
 try{
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('Capture controller startup timed out')),60000);
   controller.stdout.on('data',chunk=>{process.stdout.write(chunk);if(String(chunk).includes('CAPTURE_READY')){clearTimeout(timeout);resolve();}});
   controller.once('exit',code=>{clearTimeout(timeout);reject(Error('Controller exited '+code));});
  });
  console.log('Recording continuous V15 scene:',coach);
  const recorder=spawn(process.execPath,['record-v15.mjs',coach],{windowsHide:true,stdio:'inherit'});
  const code=await new Promise(resolve=>recorder.once('exit',resolve));
  if(code!==0)throw Error('Recording failed: '+coach);
  await closed;
 }catch(error){
  try{await fetch('http://127.0.0.1:8797/close',{method:'POST',body:'{}'});}catch{}
  if(controller.exitCode===null)controller.kill();
  throw error;
 }
}
