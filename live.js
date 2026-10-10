(() => {
 'use strict';
 if (window.top !== window.self) return;
 const $ = id=>document.getElementById(id);
 let camera=null,broadcast=null,viewer=null,busy=false;
 const tell=(id,message,isError=false)=>{
   const el=$(id); el.textContent=message;el.setAttribute('role',isError?'alert':'status');
 };
 // Avoid arbitrary exfiltration endpoints for secret WHIP URLs and public WHEP URLs.
 function endpoint(input,kind) {
   if(typeof input!=='string'||input.length>2048)throw Error('Invalid Cloudflare Stream URL.');
   let url;
   try{url=new URL(input.trim());}catch{throw Error('Enter a valid HTTPS Cloudflare Stream URL.');}
   const expected=kind==='publish'?'publish':'play';
   if(url.protocol!=='https:'||!/^customer-[a-z0-9-]+\.cloudflarestream\.com$/i.test(url.hostname)||
       url.port||url.username||url.password||url.search||url.hash||
       !new RegExp('/[a-zA-Z0-9]{16,}/webRTC/'+expected+'/?$','i').test(url.pathname)){
     throw Error('Use the official Cloudflare Stream WebRTC '+(kind==='publish'?'Publish':'Playback')+' URL.');
   }
   return url.href;
 }
 function waitIce(pc) {
   if(pc.iceGatheringState==='complete')return Promise.resolve();
   return new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>{pc.removeEventListener('icegatheringstatechange',listener);reject(Error('Timed out waiting for network connectivity.'));},20000);
     function listener(){
       if(pc.iceGatheringState==='complete'){clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',listener);resolve();}
     }
     pc.addEventListener('icegatheringstatechange',listener);
   });
 }
 async function negotiate(pc,url){
   const offer=await pc.createOffer();
   await pc.setLocalDescription(offer);
   await waitIce(pc);
   const response=await fetch(url,{method:'POST',mode:'cors',redirect:'error',
     headers:{'Content-Type':'application/sdp'},
     body:pc.localDescription.sdp,cache:'no-store'});
   if(!response.ok)throw Error('Cloudflare Stream negotiation failed (HTTP '+response.status+').');
   const answer=await response.text();
   if(!answer.startsWith('v=0')||answer.length>100000)throw Error('Invalid WebRTC negotiation response.');
   await pc.setRemoteDescription({type:'answer',sdp:answer});
   const raw=response.headers.get('Location');
   let sessionUrl=null;
   if(raw){
     const candidate=new URL(raw,url);
     if(candidate.protocol==='https:'&&candidate.origin===new URL(url).origin)sessionUrl=candidate.href;
   }
   return {pc,sessionUrl};
 }
 async function closeConnection(current){
   if(!current)return;
   current.pc.close();
   if(current.sessionUrl)try{await fetch(current.sessionUrl,{method:'DELETE',redirect:'error',cache:'no-store'});}catch{}
 }
 function stopCamera(){
   if(camera){for(const track of camera.getTracks())track.stop();camera=null;}
   $('local-preview').srcObject=null;
 }
 function refresh(){
   $('start-live').disabled=busy||!!broadcast;
   $('test-camera').disabled=busy||!!broadcast;
   $('stop-live').disabled=busy||!(broadcast||camera);
   $('start-watch').disabled=busy||!!viewer;
   $('stop-watch').disabled=busy||!viewer;
 }
 async function cameraPreview(){
   if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Camera requires a secure HTTPS browser with camera permission.');
   if(!camera||camera.getTracks().every(t=>t.readyState==='ended')){
     camera=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:true});
     $('local-preview').srcObject=camera;
   }
 }
 $('test-camera').addEventListener('click',async()=>{
   if(busy)return;
   busy=true;refresh();
   try{await cameraPreview();tell('broadcast-state','Camera preview is running locally. Not live yet.');}
   catch(e){tell('broadcast-error',e.message||'Camera unavailable.',true);stopCamera();}
   finally{busy=false;refresh();}
 });
 $('start-live').addEventListener('click',async()=>{
   if(busy||broadcast)return;
   let pc;busy=true;refresh();tell('broadcast-error','');
   try {
     const whip=endpoint($('whip-url').value,'publish');
     endpoint($('whep-url').value,'play');
     await cameraPreview();
     pc=new RTCPeerConnection();
     for(const track of camera.getTracks())pc.addTransceiver(track,{direction:'sendonly'});
     broadcast=await negotiate(pc,whip);
     // The secret publish URL is kept only in the input and this function scope.
     tell('broadcast-state','LIVE: WebRTC publish session connected. Share the public viewer link, not the private publish URL.');
   } catch(e){
     pc?.close();await closeConnection(broadcast);broadcast=null;
     stopCamera();
     tell('broadcast-state','Offline. Camera stopped.');
     tell('broadcast-error',e.message||'Unable to go live. Confirm the Stream subscription and WebRTC live input.',true);
   }finally{busy=false;refresh();}
 });
 $('stop-live').addEventListener('click',async()=>{
   if(busy)return;
   busy=true;refresh();
   await closeConnection(broadcast);broadcast=null;
   stopCamera();tell('broadcast-state','Offline. Livestream and camera stopped.');
   busy=false;refresh();
 });
 $('copy-watch').addEventListener('click',async()=>{
   try{
     const whep=endpoint($('whep-url').value,'play');
     const share=new URL('./live.html',location.href);
     share.searchParams.set('watch',whep);
     await navigator.clipboard.writeText(share.href);
     tell('broadcast-error','Viewer link copied. It contains the public playback URL only — NEVER the secret publish URL.');
   }catch(e){tell('broadcast-error',e.message||'Unable to copy link.',true);}
 });
 $('watch-self').addEventListener('click',()=>{
   try{$('watch-url').value=endpoint($('whep-url').value,'play');$('watch-url').focus();}
   catch(e){tell('broadcast-error',e.message,true);}
 });
 $('start-watch').addEventListener('click',async()=>{
   if(busy||viewer)return;
   let pc;busy=true;refresh();
   try{
     const whep=endpoint($('watch-url').value,'play');
     pc=new RTCPeerConnection();
     pc.addTransceiver('video',{direction:'recvonly'});
     pc.addTransceiver('audio',{direction:'recvonly'});
     const remote=new MediaStream();
     pc.addEventListener('track',event=>{
       remote.addTrack(event.track);$('watch-video').srcObject=remote;
     });
     viewer=await negotiate(pc,whep);
     tell('watch-state','Connected to the live Cloudflare Stream viewer session.');
   }catch(e){pc?.close();await closeConnection(viewer);viewer=null;
     $('watch-video').srcObject=null;
     tell('watch-state',e.message||'Could not open stream. Confirm broadcaster is live.',true);
   }finally{busy=false;refresh();}
 });
 $('stop-watch').addEventListener('click',async()=>{
   if(busy)return;busy=true;refresh();
   await closeConnection(viewer);viewer=null;$('watch-video').srcObject=null;
   tell('watch-state','Viewing stopped.');busy=false;refresh();
 });
 window.addEventListener('pagehide',()=>{
   // Stop local devices immediately. Network cleanup is best effort on unload.
   broadcast?.pc.close();viewer?.pc.close();stopCamera();
 });
 const watched=new URL(location.href).searchParams.get('watch');
 if(watched){
   try{$('watch-url').value=endpoint(watched,'play');}
   catch{tell('watch-state','Invalid public viewer link.',true);}
 }
 refresh();
})();