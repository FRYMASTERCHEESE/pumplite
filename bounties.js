(() => {
 'use strict';
 if (window.top !== window.self) return;
 const $ = id => document.getElementById(id);
 const storageKey='pumplite:bounty-drafts:v1';
 const rules={solana:{asset:'SOL',decimals:9},base:{asset:'ETH',decimals:18}};
 const amountOk=(raw,network)=>{
   const rule=rules[network];
   if (!rule||typeof raw!=='string'||raw.length>24||!/^(?:0|[1-9]\d{0,11})(?:\.\d+)?$/.test(raw)) return false;
   const [whole,fract='']=raw.split('.');
   return fract.length<=rule.decimals && BigInt(whole+fract.padEnd(rule.decimals,'0'))>0n;
 };
 let drafts=[];
 try {
   const saved=JSON.parse(localStorage.getItem(storageKey)||'[]');
   if(Array.isArray(saved)) drafts=saved.slice(0,50).filter(x=>x&&rules[x.network]&&
     typeof x.title==='string'&&typeof x.description==='string'&&typeof x.id==='string'&&
     amountOk(x.amount,x.network) && /^\d{4}-\d{2}-\d{2}$/.test(x.deadline||''));
 }catch{}
 const status=(message,isError=false)=>{
   $('bounty-status').textContent=message;
   $('bounty-status').setAttribute('role',isError?'alert':'status');
 };
 const save=()=>{
   try{localStorage.setItem(storageKey,JSON.stringify(drafts));return true;}
   catch{status('Browser storage unavailable. Drafts last for this tab only.',true);return false;}
 };
 const render=()=>{
   const list=$('bounty-list');list.replaceChildren();$('bounty-count').textContent=String(drafts.length);
   if(!drafts.length){const p=document.createElement('p');p.className='muted';p.textContent='No drafts yet.';list.append(p);return;}
   for (const draft of drafts.slice().reverse()){
     const box=document.createElement('article');box.className='draft';
     const name=document.createElement('strong');name.textContent=draft.title;
     const meta=document.createElement('small');
     meta.textContent=draft.amount+' '+rules[draft.network].asset+' · '+draft.network+' · deadline '+draft.deadline+' · PRIVATE / UNFUNDED';
     const desc=document.createElement('p');desc.className='muted';desc.textContent=draft.description;
     const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Delete draft';
     remove.addEventListener('click',()=>{drafts=drafts.filter(x=>x.id!==draft.id);save();render();});
     box.append(name,meta,desc,remove);list.append(box);
   }
 };
 $('bounty-network').addEventListener('change',()=>{
   $('bounty-asset').textContent=rules[$('bounty-network').value].asset+' reward amount';
 });
 const today=new Date().toISOString().slice(0,10);$('bounty-deadline').min=today;
 $('bounty-form').addEventListener('submit',event=>{
   event.preventDefault();
   const network=$('bounty-network').value, amount=$('bounty-amount').value.trim();
   const title=$('bounty-title').value.trim(),description=$('bounty-description').value.trim();
   const deadline=$('bounty-deadline').value;
   const max=new Date(Date.now()+2*365*86400000).toISOString().slice(0,10);
   if(!amountOk(amount,network)){status('Enter a positive amount in SOL (up to 9 decimals) or Base ETH (up to 18 decimals).',true);return;}
   if(title.length<5||title.length>90||description.length<25||description.length>2500){
     status('Title must be 5–90 characters and instructions 25–2,500 characters.',true);return;
   }
   if(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||deadline<today||deadline>max){
     status('Deadline must be within the next two years.',true);return;
   }
   if(drafts.length>=50){status('Maximum 50 private drafts. Delete an old draft first.',true);return;}
   const id=globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+String(drafts.length);
   drafts.push({id,network,amount,title,description,deadline,status:'private-unfunded'});
   const persisted=save();render();$('bounty-form').reset();$('bounty-deadline').min=today;
   $('bounty-asset').textContent='SOL reward amount';
   if(persisted)status('Private draft saved. No funds requested and no bounty published.');
 });
 $('bounty-export').addEventListener('click',async()=>{
   if(!drafts.length){status('No drafts to copy.');return;}
   const json=JSON.stringify({format:'pumplite-private-bounty-drafts-v1',funded:false,published:false,drafts},null,2);
   try{await navigator.clipboard.writeText(json);status('Private drafts copied. These are NOT funded or public.');}
   catch{status('Clipboard permission denied. Drafts remain saved in this browser.',true);}
 });
 render();
})();