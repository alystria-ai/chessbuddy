"""Focused checks for send-before-speech and common-source A/V in the repaired export."""
from pathlib import Path
import json,subprocess,os
import numpy as np
from scipy.signal import correlate
from PIL import Image,ImageDraw
R=Path(__file__).resolve().parents[1];FF=os.environ.get('FFMPEG','ffmpeg');SR=16000
t=json.loads((R/'edit/v15-timeline.json').read_text());s=next(s for s in t['scenes'] if s['coach']=='sofia')
assert s['src']==s['audioSrc'] and s['lag']==0 and s['nativeAV']
def pcm(p):
 return np.frombuffer(subprocess.check_output([FF,'-v','error','-i',str(p),'-vn','-ac','1','-ar',str(SR),'-f','f32le','pipe:1']),np.float32).astype(float)
b=pcm(s['audioSrc']);report=[];samples=[]
for id in ['sofia-file','sofia-favourite']:
 e=next(e for e in s['events'] if e['name']=='replay-start' and e.get('id')==id)
 send=max(e2['t'] for e2 in s['events'] if e2['name']=='click' and e2.get('target')=='Send message' and e2['t']<e['t'])
 a=pcm(R/'replay-data'/f'{id}.wav');offsets=[]
 for sec in [.5,len(a)/SR-1]:
  q=a[round(sec*SR):round((sec+.4)*SR)];lo=round((e['t']+sec-.7)*SR)
  part=b[lo:round((e['t']+sec+1.3)*SR)]
  c=correlate(part,q,mode='valid',method='fft');energy=np.convolve(part**2,np.ones(len(q)),mode='valid')
  coeff=c/np.sqrt(np.maximum(energy*np.sum(q*q),1e-16));coeff[energy<.001]=0;i=int(np.argmax(coeff))
  offsets.append({'sourceSecond':sec,'recordingStart':(lo+i)/SR-sec,'correlation':float(coeff[i])})
 first=offsets[0]['recordingStart'];assert first>send, 'Audio begins before Send'
 report.append({'id':id,'send':send,'audioStart':first,'afterSend':first-send,'matches':offsets})
 samples.extend([(id+' BEFORE SEND',s['offset']+send-s['start']-.15),(id+' SPEAKING',s['offset']+first-s['start']+.6)])
sheet=Image.new('RGB',(2560,1490),'#222');d=ImageDraw.Draw(sheet)
for i,(label,at) in enumerate(samples):
 path=R/'edit'/f'sofia-sync-{i}.png'
 subprocess.run([FF,'-v','error','-y','-ss',str(at),'-i',str(R/'final/Chessbuddy-Demo-v15-1440p.mp4'),'-frames:v','1',str(path)],check=True)
 frame=Image.open(path).resize((1280,720));x=(i%2)*1280;y=(i//2)*745;sheet.paste(frame,(x,y+25));d.text((x+10,y+5),label+' '+str(round(at,3)),fill='white')
sheet.save(R/'edit/sofia-sync-comparison.png')
(R/'edit/sofia-sync-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
