// PumpLite mobile app shell. All values and coin links are read from existing
// reviewed PumpLite UI; this module never invents trades, posts or balances.
// No wallet signatures, RPC writes or keys are requested by this module.
(() => {
  'use strict';
  // The main wallet app intentionally refuses embedded frames. Never run
  // mobile-shell mutations after its anti-embedding guard removes the UI.
  if (window.top !== window.self || !document.getElementById('app-wallet-chip')) return;
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
  // A followed-coin list works without creating fake social profiles, server data
  // or a wallet signature. Entries are public market identifiers on this device.
  const followsStorageKey = 'pumplite:followed-markets:v1';
  const validMarketKey = value => {
    if (typeof value !== 'string' || value.length > 80) return false;
    const [network, market] = value.split(':');
    return network === 'base'
      ? /^0x[0-9a-f]{40}$/.test(market || '')
      : network === 'solana' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(market || '');
  };
  let persistentFollows = true;
  function readFollows() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(followsStorageKey) || '[]');
      if (!Array.isArray(saved)) return new Set();
      return new Set(saved.slice(0,100).filter(validMarketKey));
    } catch {
      persistentFollows = false;
      return new Set();
    }
  }
  const follows = readFollows();
  function saveFollows() {
    try {
      window.localStorage.setItem(followsStorageKey, JSON.stringify([...follows].slice(0,100)));
      persistentFollows = true;
    } catch {
      persistentFollows = false; // Session memory still works when storage is blocked.
    }
  }
  function keyForMarketHref(href) {
    const chain = $('chain')?.value;
    if (!['base','solana'].includes(chain) || typeof href !== 'string') return null;
    const prefix = '#' + chain + '/';
    if (!href.startsWith(prefix)) return null;
    let id;
    try { id = decodeURIComponent(href.slice(prefix.length)); } catch { return null; }
    const key = chain + ':' + (chain === 'base' ? id.toLowerCase() : id);
    return validMarketKey(key) ? key : null;
  }
  const keyForCard = card => keyForMarketHref(card?.getAttribute('href') || '');
  function toggleFollow(key) {
    if (!validMarketKey(key)) return;
    if (follows.has(key)) follows.delete(key);
    else {
      if (follows.size >= 100) return;
      follows.add(key);
    }
    saveFollows();
    renderFeed();
    syncMarketFollowButton();
  }
  function marketRows() {
    const seen = new Set();
    const cards = [
      ...originals.home?.querySelectorAll('a.token-market-card') || [],
      ...originals.markets?.querySelectorAll('a.token-market-card') || []
    ];
    return cards.filter(card => {
      const key = keyForCard(card);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0,300);
  }

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
    const source = currentFeed === 'top' ? originals.markets : originals.home;
    const rows = currentFeed === 'following'
      ? marketRows().filter(card => follows.has(keyForCard(card))).slice(0,100)
      : [...source?.querySelectorAll('a.token-market-card') || []]
          .slice(0,currentFeed === 'top' ? 12 : 8);
    if (!rows.length) {
      if (currentFeed === 'following') {
        const box = block('div','app-feed-empty');
        box.append(block('p','',follows.size
          ? 'No followed coins are loaded on this network. Browse markets or change networks to find your saved coins.'
          : 'No coins followed yet. Tap ☆ Follow beside a coin in Callouts or Top to save it on this device.'));
        const browse = block('button','app-feed-browse','Explore coins →');
        browse.type = 'button';
        browse.addEventListener('click',explore);
        box.append(browse);
        view.append(box);
        return;
      }
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
      const marketKey = keyForCard(card);
      if (marketKey) {
        const followed = follows.has(marketKey);
        const follow = block('button','app-follow-toggle', followed ? '★ Following' : '☆ Follow');
        follow.type = 'button';
        follow.setAttribute('aria-pressed',String(followed));
        follow.setAttribute('aria-label',(followed ? 'Unfollow ' : 'Follow ') + title + ' on this device');
        follow.addEventListener('click',() => toggleFollow(marketKey));
        byline.append(follow);
      }
      const message = block('p','',
        currentFeed === 'top' ? 'Top loaded market by curve-implied market cap.' :
        currentFeed === 'following' ? 'Saved on this device. Open its on-chain market.' :
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
    view.append(block('p','app-feed-disclosure', currentFeed === 'following'
      ? 'Following saves public coin addresses on this device only, not social accounts. ' +
        (persistentFollows ? 'Saved locally in this browser.' : 'Browser storage is blocked: saved for this session only.')
      : 'Market activity only. These are on-chain market listings, not user-written posts, endorsements or investment advice. Top ranks loaded markets only.'));
  }

  function queueFeed() {
    if (renderPending) return;
    renderPending = true;
    queueMicrotask(() => { renderPending = false; renderFeed(); });
  }
  for (const source of Object.values(originals)) {
    if (source) new MutationObserver(queueFeed).observe(source,{childList:true,subtree:true,characterData:true});
  }
  // Also make the Follow control available on the token's market detail page,
  // so any coin discovered in Explore can be saved without a backend.
  const marketActions = document.querySelector('.terminal-market-actions');
  const marketFollow = block('button','app-market-follow','☆ Follow');
  marketFollow.type = 'button';
  marketFollow.hidden = true;
  function syncMarketFollowButton() {
    if (!marketActions) return;
    const key = keyForMarketHref(window.location.hash);
    const marketVisible = !$('market-page')?.hidden;
    marketFollow.hidden = !key || !marketVisible;
    if (!key || !marketVisible) return;
    const followed = follows.has(key);
    marketFollow.textContent = followed ? '★ Following' : '☆ Follow';
    marketFollow.setAttribute('aria-pressed',String(followed));
    marketFollow.setAttribute('aria-label', followed ? 'Unfollow this coin' : 'Follow this coin on this device');
  }
  if (marketActions) {
    marketActions.append(marketFollow);
    marketFollow.addEventListener('click',() => {
      const key = keyForMarketHref(window.location.hash);
      if (key) toggleFollow(key);
    });
    window.addEventListener('hashchange', syncMarketFollowButton);
    if ($('market-page')) new MutationObserver(syncMarketFollowButton)
      .observe($('market-page'), {attributes:true,attributeFilter:['hidden']});
    syncMarketFollowButton();
  }
  $('chain')?.addEventListener('change', () => { queueFeed(); syncMarketFollowButton(); });
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
