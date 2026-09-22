"""Continuous take edit; genuine pre-recorded Convai responses, not a latency benchmark."""
from pathlib import Path
import subprocess,json,math,wave,sys,os
import numpy as np
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parents[1];E=R/'edit';C=R/'capture';F=R/'final'
FF=os.environ.get('FFMPEG','ffmpeg');FP=os.environ.get('FFPROBE','ffprobe');SR=48000
NARRATION_META_PATH=R/'audio/v15-narration.json'
NARRATION_META=json.loads(NARRATION_META_PATH.read_text(encoding='utf-8'))
NARRATION_IDS=set(NARRATION_META.get('clips',{}))
def run(a):subprocess.run([str(x) for x in a],check=True)
def duration(p):return float(subprocess.check_output([FP,'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(p)]))
def pcm(p,start=0,length=None):
 a=[FF,'-v','error','-ss',str(start),'-i',str(p)]
 if length is not None:a+=['-t',str(length)]
 return np.frombuffer(subprocess.check_output(a+['-vn','-ac','2','-ar',str(SR),'-f','f32le','pipe:1']),dtype=np.float32).reshape(-1,2).copy()
def norm(a,target=-21):
 b=480;n=len(a)//b;v=np.sqrt(np.mean(a[:n*b].reshape(n,b,2)**2,axis=(1,2)));active=v[v>.008]
 level=float(np.sqrt(np.mean(active**2))) if len(active) else .1
 return a*min(2.,10**(target/20)/max(level,1e-6),.82/max(float(abs(a).max()),1e-6))
def font(n,b=False):return ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf' if b else 'C:/Windows/Fonts/segoeui.ttf',n)
def validate_sofia_events(events):
 def at(name,id=None):return next(i for i,e in enumerate(events) if e['name']==name and (id is None or e.get('id')==id))
 if any('sofia-recapture' in e['name'] or e.get('id')=='sofia-recapture' for e in events):raise RuntimeError('Sofia V15 still contains the removed sofia-recapture chat')
 order=[
  at('narration:context'),at('automatic-move-reaction'),
  next(i for i,e in enumerate(events) if e['name']=='piece-move' and e.get('from')=='a2' and e.get('to')=='b3' and e.get('capture') is True),
  at('replay-start','sofia-move'),at('narration:reaction'),at('typing-start:sofia-file'),at('replay-start','sofia-file'),
  at('narration:vision'),at('narration:memory'),at('typing-start:sofia-favourite'),at('replay-start','sofia-favourite'),
 ]
 if order!=sorted(order):raise RuntimeError('Sofia V15 events are out of context/automatic-move/move/reply/reaction/file/vision/memory/favourite order')
card=Image.new('RGBA',(1080,584));d=ImageDraw.Draw(card);d.rounded_rectangle((0,0,1079,583),32,fill=(26,47,40,248));d.text((64,46),'CHESSBUDDY',font=font(26,True),fill='#bfd4c7');d.text((60,103),'Your next move',font=font(70,True),fill='white');d.text((60,186),'starts here.',font=font(70,True),fill='white');d.rounded_rectangle((64,338,1016,451),22,fill='#d8645a');d.text((110,348),'chessbuddy.live',font=font(62,True),fill='white');d.text((64,490),'Recorded coach responses • edited feature walkthrough',font=font(25),fill='#bfd4c7');card.save(E/'v15-closing.png')
scenes=[];offset=0
for coach in ['leila','sofia','magnus','arjun']:
 audio_src=C/f'v15-{coach}.webm'
 if not audio_src.exists():audio_src=C/f'v15-{coach}.mp4'
 # Sofia's alternate Playwright video drifts behind tab playback after startup.
 # Preserve the native recorder's common A/V timestamps instead of correcting
 # individual utterances or pairing it with a separately clocked video stream.
 native_av=coach=='sofia'
 src=C/f'v15-{coach}-visual.webm';alternate=src.exists() and not native_av
 if not alternate:src=audio_src
 events=json.loads((C/f'v15-{coach}-events.json').read_text(encoding='utf-8'));origin=events[0]['nodeTime']
 for e in events:e['t']=(e['nodeTime']-origin)/1000
 if coach=='sofia':validate_sofia_events(events)
 for e in events:
  if not e['name'].startswith('narration:'):continue
  narration_id=e['name'].split(':',1)[1]
  if narration_id not in NARRATION_IDS:raise RuntimeError(f'{coach}: narration {narration_id!r} missing from {NARRATION_META_PATH.name}')
  if not (R/'audio'/f'v15-{narration_id}.wav').exists():raise RuntimeError(f'{coach}: audio/v15-{narration_id}.wav missing')
 start=next(e['t'] for e in events if e['name']=='scene-in')
 end=next(e['t'] for e in events if e['name']=='record-end') if alternate or native_av else duration(src)
 length=math.floor((end-start)*30)/30
 # Calibrate recorded tab output against the flash again, independently of source-reply packaging.
 calibration=next(e for e in events if e['name']=='calibration')
 crop='crop=80:80:8:8,' if calibration.get('rect',{}).get('width')==96 else ''
 scan=duration(src) if alternate else start
 v=np.frombuffer(subprocess.check_output([FF,'-v','error','-i',str(src),'-t',str(scan),'-vf',crop+'fps=60,scale=32:18,format=gray','-f','rawvideo','pipe:1']),dtype=np.uint8).reshape(-1,18,32)
 white=np.flatnonzero(v.mean(axis=(1,2))>249)
 if not len(white):raise RuntimeError(f'{coach}: calibration flash missing; retake instead of guessing sync')
 runs=np.split(white,np.flatnonzero(np.diff(white)>1)+1)
 flash=(runs[-1][0] if alternate else white[0])/60
 a=pcm(audio_src,length=start).mean(axis=1);b=a[:len(a)//240*240].reshape(-1,240);tone=np.flatnonzero(np.sqrt(np.mean(b*b,axis=1))>.035)[0]*.005
 if alternate or native_av:
  shift=flash-calibration['t']
  start+=shift
  for e in events:e['t']+=shift
 s={'coach':coach,'start':start,'length':length,'offset':offset,'events':events,'src':str(src),'audioSrc':str(audio_src),'lag':0 if native_av else tone-flash,'nativeAV':native_av,'calibrationFlash':flash,'calibrationTone':tone};scenes.append(s);offset+=length
print('Timeline',[(s['coach'],s['length']) for s in scenes],flush=True)
for s in scenes:
 if '--mix-only' in sys.argv:continue
 if '--sofia-only' in sys.argv and s['coach']!='sofia':continue
 coach=s['coach'];events=s['events'];start=s['start'];length=s['length'];windows=[];marks=[]
 rect=json.loads((C/f'v15-{coach}-rects.json').read_text())['.chess-board']
 for event in events:
  name=event['name'];t=event['t']-start
  if name.startswith('typing-start:'):
   end=next(x['t'] for x in events if x['name']==name.replace('typing-start:','typing-end:'))-start
   windows.append((max(0,t-.25),end+.45,1.6,490,1185))
  if name=='piece-move' and event.get('from')=='c3' and event.get('to')=='d5':marks.append((t+.08,t+3.3,['d5','e7']))
 if coach=='leila':
  windows.append((3,7,1.52,1940,970));marks.append((1,8,['f3','g4','d1']))
  mate=next(e['t']-start for e in events if e['name']=='replay-start' and e.get('id')=='leila-mate')
  words=json.loads((E/'leila-mate-words.json').read_text(encoding='utf-8'))['words']
  mentions={square:next(w for w in words if w['word'].strip(' ,.!?').lower()==square) for square in ['f7','e7','d5']}
  f7=mentions['f7']['start'];e7=mentions['e7']['start'];d5=mentions['d5']['start']
  # Arrive on f7 before the spoken square, hold through the king reply, then return.
  windows.append((mate+f7-.55,mate+e7+1.55,1.95,rect['x']+5.5*rect['w']/8,rect['y']+1.5*rect['w']/8))
  marks.extend([(mate+f7-.3,mate+e7+.15,['f7']),(mate+e7-.3,mate+e7+1.4,['e7']),(mate+d5-.3,mate+d5+2,['d5'])])
  s['spokenSquareCues']={square:{'wordStart':mate+w['start'],'wordEnd':mate+w['end']} for square,w in mentions.items()}
 if coach=='sofia':
  for e in events:
   if e['name']=='replay-start' and e.get('id')=='sofia-move':marks.append((e['t']-start+.6,e['t']-start+7,['b3','a2']))
   if e['name']=='replay-start' and e.get('id')=='sofia-file':
    at=e['t']-start;marks.append((at+1,at+8,['a1','a6']));windows.append((at+2,at+6,1.43,1440,855))
 args=[FF,'-hide_banner','-loglevel','warning','-y','-ss',str(start),'-i',s['src']];filters=[];v='0:v';input_index=1
 rect=json.loads((C/f'v15-{coach}-rects.json').read_text())['.chess-board']
 for j,(a,b,squares) in enumerate(marks):
  im=Image.new('RGBA',(2560,1440));p=ImageDraw.Draw(im);cell=rect['w']/8
  for square in squares:
   x=rect['x']+(ord(square[0])-97)*cell;y=rect['y']+(8-int(square[1]))*cell
   p.rounded_rectangle((int(x+7),int(y+7),int(x+cell-7),int(y+cell-7)),12,outline=(225,137,100,235),width=5)
  path=E/f'v15-{coach}-mark{j}.png';im.save(path);args+=['-loop','1','-i',path]
  filters += [f'[{input_index}:v]format=rgba,fade=t=in:st={a}:d=0.25:alpha=1,fade=t=out:st={b}:d=0.25:alpha=1[m{j}]',f'[{v}][m{j}]overlay=0:0:shortest=1[v{j}]'];v=f'v{j}';input_index+=1
 if coach=='arjun':
  at=next(e['t']-start for e in events if e['name']=='closing');args+=['-loop','1','-i',E/'v15-closing.png'];filters += [f'[{input_index}:v]format=rgba,fade=t=in:st={at}:d=0.4:alpha=1[cta]',f'[{v}][cta]overlay=1240:390:shortest=1[closed]'];v='closed'
 if windows:
  blends=[];cx='1280';cy='720'
  for a,b,z,x,y in windows:
   u=f'min(1,max(0,(on/30-{a})/.4))';w=f'min(1,max(0,({b}-on/30)/.4))';blend=f'({u}*{u}*(3-2*{u}))*({w}*{w}*(3-2*{w}))';blends.append(f'{z-1}*({blend})')
   cx=f'if(between(on/30,{a},{b}),{x},{cx})';cy=f'if(between(on/30,{a},{b}),{y},{cy})'
  zoom='1+'+'+'.join(blends)
  filters.append(f"[{v}]fps=30,scale=5120:2880:flags=bicubic,zoompan=z='{zoom}':x='min(iw-iw/zoom,max(0,2*({cx})-iw/zoom/2))':y='min(ih-ih/zoom,max(0,2*({cy})-ih/zoom/2))':d=1:s=2560x1440:fps=30,format=yuv420p[out]")
 else:filters.append(f'[{v}]fps=30,format=yuv420p[out]')
 print('Rendering',coach,flush=True);run(args+['-filter_complex',';'.join(filters),'-map','[out]','-an','-t',str(length),'-c:v','h264_nvenc','-preset','p5','-cq','18','-b:v','0',E/f'v15-{coach}.mp4'])
# Use the encoded frame counts for exact concat offsets, not requested trim durations.
offset=0
for s in scenes:
 s['length']=duration(E/f"v15-{s['coach']}.mp4");s['offset']=offset;offset+=s['length']
mix=np.zeros((round(offset*SR),2),np.float32);narration=[];piece_times=[]
def add(a,t):
 i=round(t*SR);n=min(len(a),len(mix)-i)
 if n>0:mix[i:i+n]+=a[:n]
for s in scenes:
 add(norm(pcm(s['audioSrc'],s['start']+s['lag'],s['length'])),s['offset'])
 for e in s['events']:
  t=s['offset']+e['t']-s['start']
  if e['name'].startswith('narration:'):
   id=e['name'].split(':',1)[1];a=norm(pcm(R/'audio'/f'v15-{id}.wav'));add(a,t);narration.append({'id':id,'time':t,'duration':len(a)/SR})
  if e['name']=='piece-move':
   a=pcm(R/'audio/piece-place.wav')*(1.12 if e.get('capture') else 1);add(a,t+.035);piece_times.append({'t':t,'from':e['from'],'to':e['to']})
music=pcm(R/'audio/meanwhile-scott-buckley.mp3',start=8,length=112);music*=10**(-38/20)/max(float(np.sqrt(np.mean(music**2))),1e-6)
# Crossfade repeated music beds only if the continuous timeline exceeds one track pass.
bed=np.zeros_like(mix);pos=0;cross=SR*5
while pos<len(bed):
 n=min(len(music),len(bed)-pos);part=music[:n].copy()
 if pos:part[:min(cross,n)]*=np.linspace(0,1,min(cross,n))[:,None]
 if pos+n<len(bed):part[-cross:]*=np.linspace(1,0,cross)[:,None]
 bed[pos:pos+n]+=part
 if pos+n>=len(bed):break
 pos+=n-cross
block=480;n=math.ceil(len(mix)/block);duck=np.ones(n);value=1
for i in range(n):
 active=np.sqrt(np.mean(mix[i*block:min((i+1)*block,len(mix))]**2))>.007;target=10**(-5.5/20) if active else 1
 value+=(target-value)*(1-math.exp(-.01/(.13 if active else .65)));duck[i]=value
bed*=np.interp(np.arange(len(mix))/block,np.arange(n),duck)[:,None];fade=SR*2;bed[:fade]*=np.linspace(0,1,fade)[:,None];bed[-fade:]*=np.linspace(1,0,fade)[:,None];mix+=bed;peak=float(abs(mix).max())
if peak>.95:mix*=.95/peak
with wave.open(str(E/'v15-mix.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(SR);f.writeframes((np.clip(mix,-1,1)*32767).astype('<i2').tobytes())
(E/'v15-concat.txt').write_text('\n'.join("file '"+str(E/f"v15-{s['coach']}.mp4").replace('\\','/')+"'" for s in scenes))
run([FF,'-v','warning','-y','-f','concat','-safe','0','-i',E/'v15-concat.txt','-i',E/'v15-mix.wav','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-movflags','+faststart','-shortest',F/'Chessbuddy-Demo-v15-1440p.mp4'])
(E/'v15-timeline.json').write_text(json.dumps({'scenes':scenes,'narration':narration,'pieceSounds':piece_times,'duration':offset,'peak':peak,'musicRmsDb':-38,'duckDb':-5.5,'music':'Meanwhile - Scott Buckley','narrationMetadata':'audio/v15-narration.json'},indent=2),encoding='utf-8')
print('COMPLETE',offset,flush=True)
