import { manualMayhemReady } from './activation-recovery.js';
import { updateTokenMayhem, renderTokenDetailCard } from './token-detail-card.js';
import { reservationRecovery, authorizationMatches } from './mayhem-reservation-policy.js';
import { launchStage } from './launch-retry.js';
import {
  MAYHEM,
  mayhemMessage,
  mayhemNonce,
  requestRecord
} from './mayhem-protocol.js';

export const MAYHEM_RELEASE_ENABLED = true;

const ENDPOINT =
  'https://pumplite-rpc.coreyedge123.workers.dev';

let renderedKey = null;

function make(tag, text, className = '') {
  const node =
    document.createElement(tag);

  if (text !== undefined) {
    node.textContent = text;
  }

  if (className) {
    node.className = className;
  }

  return node;
}

function creationNodes() {
  return {
    box:
      document.getElementById(
        'solana-pump-options'
      ),

    input:
      document.getElementById(
        'solana-mayhem'
      ),

    off:
      document.getElementById(
        'solana-mayhem-off'
      ),

    manual:
      document.getElementById(
        'solana-mayhem-manual'
      ),

    title:
      document.getElementById(
        'solana-mayhem-detail-title'
      ),

    state:
      document.getElementById(
        'solana-mayhem-detail-state'
      ),

    copy:
      document.getElementById(
        'solana-mayhem-detail-copy'
      ),

    points:
      document.getElementById(
        'solana-mayhem-detail-points'
      )
  };
}

function setCreationMode(mode) {
  if (!['off', 'manual'].includes(mode)) {
    mode = 'off';
  }

  const nodes =
    creationNodes();

  if (
    !nodes.input ||
    !nodes.off ||
    !nodes.manual
  ) {
    return;
  }

  nodes.input.value = mode;

  const manual =
    mode === 'manual';

  nodes.off.classList.toggle(
    'is-active',
    !manual
  );

  nodes.manual.classList.toggle(
    'is-active',
    manual
  );

  nodes.off.setAttribute(
    'aria-pressed',
    String(!manual)
  );

  nodes.manual.setAttribute(
    'aria-pressed',
    String(manual)
  );

  if (
    nodes.title &&
    nodes.state &&
    nodes.copy &&
    nodes.points
  ) {
    if (manual) {
      nodes.title.textContent =
        'Manual';

      nodes.state.textContent =
        'You fire each trade';

      nodes.copy.textContent =
        'The Mayhem Agent trades only when the coin creator presses Trigger Agent Trade.';

      nodes.points.replaceChildren(
        make(
          'li',
          'The creator controls when a trade is requested.'
        ),
        make(
          'li',
          'Buy or sell direction is randomly selected by the Mayhem Agent.'
        ),
        make(
          'li',
          'Trade size is randomly selected by the Mayhem Agent.'
        ),
        make(
          'li',
          'Available only during the coin’s first 24 hours.'
        )
      );
    } else {
      nodes.title.textContent =
        'Off';

      nodes.state.textContent =
        'No agent trades';

      nodes.copy.textContent =
        'The Mayhem Agent will not trade this coin.';

      nodes.points.replaceChildren(
        make(
          'li',
          'Normal PumpLite trading only.'
        )
      );
    }
  }
}

function ensureCreationControls() {
  const nodes =
    creationNodes();

  if (
    !nodes.input ||
    !nodes.off ||
    !nodes.manual
  ) {
    return;
  }

  if (
    nodes.input.dataset.bound !== '1'
  ) {
    nodes.input.dataset.bound = '1';

    nodes.off.addEventListener(
      'click',
      () =>
        setCreationMode('off')
    );

    nodes.manual.addEventListener(
      'click',
      () => {
        if (!nodes.manual.disabled) {
          setCreationMode(
            'manual'
          );
        }
      }
    );
  }

  setCreationMode(
    nodes.input.value
  );
}

function setCreationAvailability(
  enabled
) {
  ensureCreationControls();

  const nodes =
    creationNodes();

  if (
    !nodes.input ||
    !nodes.manual
  ) {
    return;
  }

  nodes.manual.disabled =
    !enabled;

  if (
    !enabled &&
    nodes.input.value === 'manual'
  ) {
    setCreationMode('off');
  }
}

export function configureMayhemCreation(
  select,
  chain
) {
  ensureCreationControls();

  const nodes =
    creationNodes();

  if (nodes.box) {
    nodes.box.hidden =
      chain !== 'solana';
  }

  if (!MAYHEM_RELEASE_ENABLED) {
    setCreationAvailability(false);
    setCreationMode('off');
  }

  if (select) {
    select.disabled =
      !MAYHEM_RELEASE_ENABLED;
  }
}

export function selectedMayhemMode(
  select
) {
  const mode =
    select?.value || 'off';

  if (
    !['off', 'manual'].includes(mode) ||
    (
      !MAYHEM_RELEASE_ENABLED &&
      mode !== 'off'
    )
  ) {
    throw Error(
      'Mayhem controller is not enabled'
    );
  }

  return mode;
}

async function api(
  path,
  body
) {
  const {
    boundedFetch
  } =
    await import(
      './rpc-fetch.js'
    );

  const response =
    await launchStage(path === 'authorize' ? 'Mint authorization failed' : 'Mayhem service unavailable', () => boundedFetch(
      ENDPOINT +
        '/mayhem/' +
        path,
      body
        ? {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json'
            },
            body:
              JSON.stringify(
                body
              )
          }
        : {},
      {
        maxBytes:
          262144
      }
    ));

  const payload = await response.json();
  if (!response.ok || payload.error) throw Error(payload.error || 'Mayhem service rejected the request');
  return payload;
}

export async function
signedMayhemRequest(
  launch,
  creator,
  signMessage,
  send,
  now = Date.now()
) {
  if (
    !manualMayhemReady(launch,now) ||
    launch.creator !== creator ||
    launch.mode !== 'manual' ||
    launch.status === 'ended' ||
    now >= launch.expiresAt ||
    launch.pending
  ) {
    throw Error(
      'Trigger is unavailable'
    );
  }

  const record =
    requestRecord(
      launch,
      now
    );

  const signature =
    await signMessage(
      mayhemMessage(
        'request',
        record
      )
    );

  return send({
    record,
    signature
  });
}

export function renderMayhemPanel(
  host,
  launch,
  {
    wallet = null,
    enabled = false,
    onAuthorize = null,
    onTrigger = null
  } = {}
) {
  host.replaceChildren();

  host.hidden =
    !launch;

  if (!launch) {
    return;
  }

  host.classList.add(
    'mayhem-agent-panel'
  );

  const status =
    Date.now() >=
      launch.expiresAt
      ? 'ended'
      : launch.status;

  const statusText =
    {
      active: 'Agent active',
      paused: 'Agent paused',
      ended: 'Agent ended'
    }[status] ||
    'Unavailable';

  const top =
    make(
      'div',
      undefined,
      'mayhem-agent-top'
    );

  const heading =
    make(
      'div'
    );

  heading.append(
    make(
      'p',
      'MAYHEM AGENT',
      'mayhem-kicker'
    ),
    make(
      'h3',
      'Manual Mayhem'
    )
  );

  top.append(
    heading,
    make(
      'span',
      statusText,
      'mayhem-agent-status ' +
        status
    )
  );

  host.append(
    top,
    make(
      'p',
      'You fire each trade. Buy/sell direction and trade size are randomly selected by the Mayhem Agent.',
      'mayhem-agent-description'
    )
  );

  const disclosure =
    make(
      'p',
      'Mayhem Agent activity is automated activity, not organic user demand. Normal PumpLite 0.25% trading fee applies. Manual Mayhem ends within 24 hours.',
      'fine mayhem-agent-disclosure'
    );

  host.append(disclosure);

  if (
    launch.mode === 'manual' &&
    wallet === launch.creator
  ) {
    const needsAuthorization =
      launch.canonicalActivation === true &&
      launch.hasActivity === false &&
      Boolean(
        launch.reservation?.mint
      ) &&
      launch.mint !==
        launch.reservation.mint &&
      status !== 'ended';

    if (
      needsAuthorization &&
      onAuthorize
    ) {
      host.append(
        make(
          'p',
          'The activation is confirmed. Sign one message to bind Manual Mayhem to the activated mint. This does not spend SOL or submit another activation.',
          'fine mayhem-agent-disclosure'
        )
      );

      const authorize =
        make(
          'button',
          'Authorize Manual Mayhem',
          'outline'
        );

      authorize.type =
        'button';

      authorize.addEventListener(
        'click',
        async () => {
          authorize.disabled =
            true;

          authorize.textContent =
            'Waiting for wallet signature...';

          try {
            await onAuthorize();

            authorize.textContent =
              'Manual Mayhem authorized';
          } catch {
            authorize.disabled =
              false;

            authorize.textContent =
              'Authorize Manual Mayhem';
          }
        }
      );

      host.append(
        authorize
      );
    }

    // Only an active, canonical, authorized Manual Mayhem launch may
    // display an agent-trade action. Historical/paused/expired launches
    // remain visible with status and activity metrics but no trade button.
    const canTrigger =
      enabled &&
      status === 'active' &&
      manualMayhemReady(launch) &&
      !needsAuthorization &&
      !launch.pending &&
      typeof onTrigger === 'function';

    if (canTrigger) {
      const trigger =
        make(
          'button',
          'Trigger Agent Trade',
          'mayhem-trigger-button'
        );

      trigger.type = 'button';

      trigger.addEventListener(
        'click',
        async () => {
          // A displayed button must not sign after the expiry deadline.
          if (
            !manualMayhemReady(launch) ||
            Date.now() >= launch.expiresAt
          ) {
            trigger.disabled = true;
            trigger.textContent = 'Agent ended';
            return;
          }

          trigger.disabled = true;
          trigger.textContent = 'Requesting agent trade...';

          try {
            await onTrigger();
          } catch {
            trigger.textContent = 'Trigger Agent Trade';
            host.append(
              make(
                'p',
                'Trigger request failed. Refresh status before retrying.',
                'fine'
              )
            );
          }
        }
      );

      host.append(trigger);
    } else if (status === 'ended') {
      host.append(
        make(
          'p',
          'Manual Mayhem has ended. Agent trade requests are unavailable. Normal market trading remains separate.',
          'fine'
        )
      );
    } else if (status === 'paused') {
      host.append(
        make(
          'p',
          'Manual Mayhem is paused. Agent trade requests are unavailable.',
          'fine'
        )
      );
    }
  }

  const metrics =
    make(
      'div',
      undefined,
      'mayhem-metrics'
    );

  const values = [
    [
      'Organic volume',
      'organicVolume'
    ],
    [
      'Mayhem Agent volume',
      'agentVolume'
    ],
    [
      'Total volume',
      'totalVolume'
    ]
  ];

  for (
    const [title, key]
    of values
  ) {
    const card =
      make(
        'div',
        undefined,
        'mayhem-metric'
      );

    card.append(
      make(
        'small',
        title
      ),
      make(
        'strong',
        launch.metrics?.[key] ===
          null ||
        launch.metrics?.[key] ===
          undefined
          ? 'Not available yet'
          : launch.metrics[key] +
            ' lamports'
      )
    );

    metrics.append(card);
  }

  host.append(metrics);

  const confirmed =
    (launch.actions || [])
      .filter(
        action =>
          action.status ===
            'confirmed' &&
          action.isMayhemAgent ===
            true
      );

  if (confirmed.length) {
    const activity =
      make(
        'div',
        undefined,
        'mayhem-activity'
      );

    activity.append(
      make(
        'h4',
        'Agent activity'
      )
    );

    for (
      const action of confirmed
    ) {
      activity.append(
        make(
          'p',
          'Mayhem Agent • ' +
            action.side.toUpperCase() +
            ' • ' +
            action.solGross +
            ' lamports • ' +
            action.signature,
          'fine'
        )
      );
    }

    host.append(activity);
  }
}

export {
  MAYHEM
};

export async function
signCreationChoice(
  draft,
  sign
) {
  if (!MAYHEM_RELEASE_ENABLED) {
    throw Error(
      'Manual Mayhem is not enabled'
    );
  }

  const capabilities =
    await api(
      'capabilities'
    );

  if (
    capabilities.version !== 1 ||
    !capabilities.enabled ||
    capabilities.mode !==
      'manual'
  ) {
    throw Error(
      'Manual Mayhem service unavailable'
    );
  }

  const record = {
    version: 1,
    domain:
      MAYHEM.domain,
    chain:
      MAYHEM.chain,
    programId:
      MAYHEM.programId,
    launchId:
      draft.id,
    creator:
      draft.creator,
    mode:
      'manual',
    createdAt:
      draft.createdAt,
    expiresAt:
      draft.createdAt +
      MAYHEM.lifetime,
    nonce:
      mayhemNonce()
  };

  return {
    record,
    signature:
      await sign(
        mayhemMessage(
          'choice',
          record
        )
      )
  };
}

export async function syncMayhem(
  state,
  getAdapter,
  run
) {
  if(state.market)renderTokenDetailCard(state.market);
  ensureCreationControls();

  const nodes =
    creationNodes();

  if (nodes.box) {
    nodes.box.hidden =
      state.chain !== 'solana';
  }

  let panel =
    document.getElementById(
      'solana-manual-mayhem'
    );

  if (!panel) {
    panel =
      document.createElement(
        'section'
      );

    panel.id =
      'solana-manual-mayhem';

    document
      .getElementById(
        'market-metadata'
      )
      ?.after(panel);
  }

  if (
    state.chain !== 'solana'
  ) {
    panel.hidden = true;
    return;
  }

  const key =
    state.epoch +
    ':' +
    (
      state.market?.token ||
      ''
    ) +
    ':' +
    (
      state.wallet ||
      ''
    );

  if (
    key === renderedKey
  ) {
    return;
  }

  renderedKey = key;

  if (!MAYHEM_RELEASE_ENABLED) {
    setCreationAvailability(
      false
    );

    panel.hidden = true;
    return;
  }

  try {
    const cap =
      await api(
        'capabilities'
      );

    if (
      renderedKey !== key
    ) {
      return;
    }

    const enabled =
      cap.version === 1 &&
      cap.mode === 'manual' &&
      cap.enabled === true;

    setCreationAvailability(
      enabled
    );

    if (
      !enabled ||
      !state.market
    ) {
      panel.hidden = true;
      return;
    }

    const launch =
      await api(
        'mint/' +
        encodeURIComponent(
          state.market.token
        )
      );

    if (
      renderedKey !== key
    ) {
      return;
    }

    updateTokenMayhem(state.market.token,launch);
    if (
      launch.mode !== 'manual'
    ) {
      panel.hidden = true;
      return;
    }

    renderMayhemPanel(
      panel,
      launch,
      {
        wallet:
          state.wallet,
        enabled,
        onAuthorize:
          () =>
            run(
              async () => {
                const adapter =
                  await getAdapter();

                await authorizeReservedMint(
                  launch.launchId,
                  state.wallet,
                  message =>
                    adapter
                      .signMayhemMessage(
                        message
                      )
                );

                renderedKey =
                  null;

                await syncMayhem(
                  state,
                  getAdapter,
                  run
                );
              }
            ),
        onTrigger:
          () =>
            run(
              async () => {
                const adapter =
                  await getAdapter();

                await signedMayhemRequest(
                  launch,
                  state.wallet,
                  message =>
                    adapter
                      .signMayhemMessage(
                        message
                      ),
                  body =>
                    api(
                      'request',
                      body
                    )
                );

                renderedKey =
                  null;

                await syncMayhem(
                  state,
                  getAdapter,
                  run
                );
              }
            )
      }
    );
  } catch {
    setCreationAvailability(
      false
    );

    panel.hidden = false;
    panel.classList.add(
      'mayhem-agent-panel'
    );

    panel.textContent =
      'Mayhem Agent status unavailable. Trigger is disabled.';
  }
}

export async function
authorizeReservedMint(
  launchId,
  creator,
  sign
) {
  if (!MAYHEM_RELEASE_ENABLED) {
    throw Error(
      'Manual Mayhem is not enabled'
    );
  }

  const [
    launch,
    cap
  ] =
    await Promise.all([
      api(launchId),
      api('capabilities')
    ]);

  const activatedRecovery =
    launch.canonicalActivation === true &&
    launch.mode === 'manual' &&
    launch.hasActivity === false &&
    launch.mint !==
      launch.reservation?.mint &&
    launch.expiresAt >
      Date.now();

  if (
    !cap.enabled ||
    launch.creator !== creator ||
    launch.status === 'ended' ||
    !launch.reservation ||
    (
      !activatedRecovery &&
      launch.reservation.expiresAt <=
        Date.now()
    ) ||
    (
      launch.canonicalActivation === true &&
      !activatedRecovery &&
      !authorizationMatches(
        launch,
        cap.controller
      )
    )
  ) {
    throw Error(
      'Pending creator authorization unavailable'
    );
  }

  if(authorizationMatches(launch,cap.controller)) return launch;
  if(launch.authorized && launch.controller!==cap.controller) throw Error('Immutable Mayhem controller mismatch');
  const record = {
    ...launch.choice.record,
    nonce:
      mayhemNonce(),
    mint:
      launch.reservation.mint,
    controller:
      cap.controller
  };

  return api(
    'authorize',
    {
      record,
      signature:
        await sign(
          mayhemMessage(
            'authorize',
            record
          )
        )
    }
  );
}

export async function
attachMintAuthorization(
  card,
  launch,
  wallet,
  adapter,
  run
) {
  if (
    !MAYHEM_RELEASE_ENABLED ||
    wallet !== launch.creator
  ) {
    return;
  }

  const view =
    await api(
      launch.id
    );

  if (
    view.mode !== 'manual' ||
    (view.authorized && view.mint===view.reservation?.mint) ||
    view.status === 'ended' ||
    !view.reservation
  ) {
    return;
  }

  const button =
    make(
      'button',
      'Authorize Manual Mayhem',
      'outline'
    );

  button.type =
    'button';

  button.addEventListener(
    'click',
    () =>
      run(
        async () => {
          button.disabled =
            true;

          try {
            await authorizeReservedMint(
              launch.id,
              wallet,
              message =>
                adapter
                  .signMayhemMessage(
                    message
                  )
            );

            button.textContent =
              'Manual Mayhem authorized';
          } catch (error) {
            button.disabled =
              false;

            throw error;
          }
        }
      )
  );

  card.append(button);
}
export async function assertMayhemReservationRecoverable(launchId,localMint=null) {
  const view=await api(launchId);
  if(!view.canonicalActivation && view.status!=='ended' && view.expiresAt>Date.now() && view.reservation?.expiresAt>Date.now() && view.reservation.mint===localMint)return {replace:false};
  return reservationRecovery(view);
}
