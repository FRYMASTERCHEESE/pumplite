// PumpLite mobile app shell. All values and coin links are read from existing
// reviewed PumpLite UI; this module never invents trades, posts or balances.
// No wallet signatures, RPC writes or keys are requested by this module.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const mobile = window.matchMedia('(max-width:740px)');
  const view = $('app-feed-content');
  const originals = { home: $('home-markets'), markets: $('markets') };
  const feedButtons = [...document.querySelectorAll('[data-app-feed]')];
  const sortButtons = [...document.querySelectorAll('[data-app-sort]')];
  const layer = $('app-popover-layer');
  const items = $('app-sheet-items');
  let currentFeed = 'latest';
  let lastFocus = null;
  let renderPending = false;
  const plain = (element, max=120) => (element?.textContent || '').trim().slice(0,max);
  const panel = id => $(id)?.click();

  function home(){ panel('show-home'); window.scrollTo({top:0,behavior:'instant'}); }
  function explore(){ panel('show-explore'); window.scrollTo({top:0,behavior:'instant'}); }
  function create(){ panel('show-create'); $('create-section')?.scrollIntoView({block:'start'}); }
  function portfolio(){ panel('show-portfolio'); window.scrollTo({top:0,behavior:'instant'}); }
  function help(){ panel('show-help'); $('help-section')?.scrollIntoView({block:'start'}); }
  function search(){ explore(); $('market-filter')?.focus({preventScroll:true}); }

  function setFeedTab(tab) {
    currentFeed = ['latest','following','top'].includes(tab) ? tab : 'latest';
    feedButtons.forEach(b => {
      const active = b.dataset.appFeed === currentFeed;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    if (currentFeed === 'top') {
      const sort = $('market-sort');
      if (sort && sort.value !== 'market-cap') {
        sort.value = 'market-cap';
        sort.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }
    renderFeed();
  }

  function block(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function renderFeed() {
    if (!view || !mobile.matches) return;
    view.replaceChildren();
    if (currentFeed === 'following') {
      view.append(block('p','app-feed-empty',
        'Friends is not connected yet. PumpLite does not currently host social profiles or following. Switch to Callouts or Top for real on-chain markets.'));
      return;
    }
    const source = currentFeed === 'top' ? originals.markets : originals.home;
    const rows = [...source?.querySelectorAll('a.token-market-card') || []]
      .slice(0,currentFeed === 'top' ? 12 : 8);
    if (!rows.length) {
      const status = plain($('home-live-status'),180);
      view.append(block('p','app-feed-empty',
        (status && !/Reading real markets/i.test(status) ? status + ' ' : '') +
        'No on-chain coins loaded on this network yet. Use Explore or refresh live markets.'));
      return;
    }
    const network = $('chain')?.value === 'solana' ? 'Solana' : 'Base';
    $('app-feed-network').textContent = network;
    rows.forEach((card,index) => {
      const ticker = plain(card.querySelector('.ticker'),40) || 'Coin';
      const title = plain(card.querySelector('.token-card-identity b'),70) || 'On-chain market';
      const age = plain(card.querySelector('.token-age'),30);
      const mcap = plain(card.querySelector('.token-card-metrics span:nth-child(2) strong'),45);
      const post = block('article','app-market-update');
      const avatar = block('span','app-feed-avatar',(ticker.split(' / ')[0] || 'PL').slice(0,2));
      avatar.setAttribute('aria-hidden','true');
      const content = block('div','app-feed-body');
      const byline = block('div','app-feed-line');
      byline.append(block('strong','', 'PumpLite markets'),block('small','',
        (currentFeed === 'top' ? 'Rank #'+(index+1)+' · ' : '')+network+' · '+(age || 'on-chain')));
      const message = block('p','',
        currentFeed === 'top' ? 'Top loaded market by curve-implied market cap.' :
        'A coin listed on PumpLite. See real price, curve and trading details.');
      const link = block('a','app-feed-market');
      link.href = card.getAttribute('href') || '#';
      link.setAttribute('aria-label','View '+title+' market and trading options');
      link.append(block('span','',ticker.slice(0,2).toUpperCase()));
      const meta = block('span','');
      meta.append(block('b','',title),block('small','',ticker + (mcap ? ' · Curve cap '+mcap : '')));
      link.append(meta,block('span','app-feed-arrow','↗'));
      content.append(byline,message,link);
      post.append(avatar,content);
      view.append(post);
    });
    view.append(block('p','app-feed-disclosure',
      'Market activity only. These are on-chain market listings, not user-written posts, endorsements or investment advice. Top ranks loaded markets only.'));
  }

  function queueFeed() {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => { renderPending = false; renderFeed(); });
  }
  for (const source of Object.values(originals)) {
    if (source) new MutationObserver(queueFeed).observe(source,{childList:true,subtree:true,characterData:true});
  }
  $('chain')?.addEventListener('change', queueFeed);
  mobile.addEventListener('change', queueFeed);
  feedButtons.forEach(b => b.addEventListener('click', () => setFeedTab(b.dataset.appFeed)));
  sortButtons.forEach(b => b.addEventListener('click', () => {
    const sort = $('market-sort');
    if (!sort) return;
    sort.value = b.dataset.appSort;
    sort.dispatchEvent(new Event('change',{bubbles:true}));
    sortButtons.forEach(x => {
      const chosen = x === b;
      x.classList.toggle('is-active',chosen);
      x.setAttribute('aria-pressed',String(chosen));
    });
  }));

  function closeSheet() {
    if (!layer || layer.hidden) return;
    layer.hidden = true;
    items.replaceChildren();
    lastFocus?.focus?.({preventScroll:true});
  }
  function openSheet(title,actions) {
    if (!layer) return;
    lastFocus = document.activeElement;
    $('app-sheet-heading').textContent = title;
    items.replaceChildren();
    for (const action of actions) {
      const button = block('button','app-menu-action');
      button.type = 'button';
      if (action.disabled) button.disabled = true;
      button.append(block('span','app-sheet-icon',action.icon));
      const label = block('span','',action.label);
      if (action.detail) label.append(block('small','',action.detail));
      button.append(label);
      button.addEventListener('click', () => {
        closeSheet();
        action.run?.();
      });
      items.append(button);
    }
    layer.hidden = false;
    $('app-action-sheet')?.focus({preventScroll:true});
  }

  const createActions = () => [
    {icon:'⊕',label:'Create coin',detail:'Create on Solana or Base Mainnet',run:create},
    {icon:'▤',label:'My coins',detail:'See your created token collection',run:()=>location.assign('./creator-tokens.html')},
    {icon:'◉',label:'Market callouts',detail:'View real on-chain token updates',run:()=>{home();setFeedTab('latest');}},
    {icon:'◈',label:'Live markets',detail:'Browse the live market feed',run:explore},
    {icon:'♧',label:'Post bounty',detail:'Unavailable — no bounty payment/escrow backend',disabled:true},
    {icon:'◉',label:'Go live video',detail:'Unavailable — no broadcast infrastructure',disabled:true}
  ];
  const moreActions = () => [
    {icon:'♕',label:'Leaderboard',detail:'Sort on-chain markets by curve cap',run:()=>{explore();sortButtons.find(b=>b.dataset.appSort==='market-cap')?.click();}},
    {icon:'〰',label:'Mayhem',detail:'Configure Mayhem while creating a coin',run:create},
    {icon:'◉',label:'Live markets',detail:'Current on-chain PumpLite markets',run:explore},
    {icon:'♧',label:'Holder rewards',detail:'Official PLITE claim',run:()=>location.assign('./claim.html')},
    {icon:'♧',label:'Rewards & portfolio',detail:'Read wallet balances',run:portfolio},
    {icon:'☷',label:'Terminal',detail:'Trading markets and advanced tools',run:explore},
    {icon:'PL',label:'PLITE',detail:'View the PLITE Base market',run:()=>{location.hash='base/0xa522A4Ef81fD31daec390ab46A32D4886e1461C7';}},
    {icon:'⚙',label:'Support & safety',detail:'Wallet help and risk warnings',run:help},
    {icon:'◎',label:'Profile / My coins',detail:'Your created tokens',run:()=>location.assign('./creator-tokens.html')},
    {icon:'⊕',label:'Post bounty',detail:'Unavailable until payments backend exists',disabled:true}
  ];
  const walletActions = () => [
    {icon:'◎',label:'Connect wallet',detail:'Approve in Phantom or an EVM wallet',run:()=>panel('connect')},
    {icon:'◉',label:'Solana Mainnet',detail:'Use the official Solana program',run:()=>setChain('solana')},
    {icon:'◆',label:'Base Mainnet',detail:'Use Base factory markets',run:()=>setChain('base')},
    {icon:'▣',label:'Wallet portfolio',detail:'Read balances, not transactions',run:portfolio},
  ];
  function setChain(chain) {
    const selector = $('chain');
    if (!selector || !['base','solana'].includes(chain)) return;
    selector.value = chain;
    selector.dispatchEvent(new Event('change',{bubbles:true}));
    queueFeed();
  }
  $('app-search')?.addEventListener('click',search);
  $('app-profile')?.addEventListener('click',portfolio);
  $('app-wallet-chip')?.addEventListener('click',()=>openSheet('Wallet & network',walletActions()));
  $('app-sheet-close')?.addEventListener('click',closeSheet);
  document.querySelector('[data-app-close]')?.addEventListener('click',closeSheet);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!layer?.hidden){event.preventDefault();closeSheet();}});
  for(const button of document.querySelectorAll('.bottom-nav button')) {
    if(button.dataset.page==='create'){
      button.addEventListener('click',()=>{if(mobile.matches)openSheet('Create & discover',createActions());});
    }
    if(button.dataset.page==='help'){
      button.addEventListener('click',()=>{if(mobile.matches)openSheet('More on PumpLite',moreActions());});
    }
    if(['home','markets','portfolio'].includes(button.dataset.page)){
      button.addEventListener('click',closeSheet);
    }
  }
  document.querySelectorAll('.terminal-market-actions button').forEach(b=>b.addEventListener('click',closeSheet));
  // Keep the top wallet chip a truthful action, never a fabricated balance.
  $('app-wallet-chip').textContent = 'Wallet ▾';
  renderFeed();
})();
