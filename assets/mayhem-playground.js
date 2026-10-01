"use strict";

const el = id => {
  const value = document.getElementById(id);
  if (!value) throw new Error("Missing playground element: " + id);
  return value;
};

const BILLION = 1_000_000_000;
const VIRTUAL_ETH = 1;
const MAYHEM_HOURS = 24;
const PAUSE_RESERVE = 0.001;
const MAX_AGENT_TRADES = 48;
const MAX_AGENT_BUY_TOTAL = 0.25;
const MAX_AGENT_SELL_TOTAL = 0.25;

const modeButtons = [
  ...document.querySelectorAll("[data-mode]")
];

let selectedMode = "classic";
let autoTimer = null;
let randomState = 0x50f5a7;

const model = {};

function seededRandom() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  randomState >>>= 0;
  return randomState / 4294967296;
}

function freshModel() {
  const mayhem =
    selectedMode !== "classic";

  Object.assign(model, {
    mode: selectedMode,
    hours: 0,
    nativeReserve: 1,
    curveTokens: BILLION,
    agentTokens: mayhem ? BILLION : 0,
    userTokens: 0,
    organicVolume: 0,
    agentVolume: 0,
    agentNativeIn: 0,
    agentNativeOut: 0,
    agentTrades: 0,
    burned: 0,
    manualPending: false,
    finalized: false
  });

  randomState =
    selectedMode === "classic"
      ? 0x13572468
      : selectedMode === "auto"
        ? 0x24681357
        : 0x50f5a7;
}

function stateName() {
  if (model.mode === "classic") {
    return "CLASSIC";
  }

  if (
    model.finalized ||
    model.hours >= MAYHEM_HOURS ||
    model.agentTrades >= MAX_AGENT_TRADES ||
    (
      model.agentNativeIn >= MAX_AGENT_BUY_TOTAL &&
      model.agentNativeOut >= MAX_AGENT_SELL_TOTAL
    )
  ) {
    return "ENDED";
  }

  if (
    model.nativeReserve <
    PAUSE_RESERVE
  ) {
    return "PAUSED";
  }

  return "ACTIVE";
}

function mayhemActive() {
  return stateName() === "ACTIVE";
}

function totalSupply() {
  return (
    model.curveTokens +
    model.agentTokens +
    model.userTokens
  );
}

function quoteBuy(input) {
  if (
    !Number.isFinite(input) ||
    input <= 0
  ) {
    return 0;
  }

  return (
    model.curveTokens *
    input /
    (
      VIRTUAL_ETH +
      model.nativeReserve +
      input
    )
  );
}

function quoteSell(tokens) {
  if (
    !Number.isFinite(tokens) ||
    tokens <= 0
  ) {
    return 0;
  }

  return (
    (VIRTUAL_ETH + model.nativeReserve) *
    tokens /
    (model.curveTokens + tokens)
  );
}

function number(value, digits = 2) {
  return Number(value).toLocaleString(
    undefined,
    {
      maximumFractionDigits: digits
    }
  );
}

function eth(value) {
  return (
    Number(value).toFixed(6) +
    " fake ETH"
  );
}

function timeText() {
  const whole = Math.floor(model.hours);
  const minutes =
    Math.floor(
      (model.hours - whole) * 60
    );

  return (
    whole +
    "h " +
    String(minutes).padStart(2, "0") +
    "m"
  );
}

function log(kind, direction, detail) {
  const row =
    document.createElement("div");

  row.className =
    "playground-log-row";

  const badge =
    document.createElement("strong");

  badge.className =
    kind === "agent"
      ? "playground-log-agent"
      : "playground-log-user";

  badge.textContent =
    kind === "agent"
      ? "MAYHEM AGENT"
      : "ORGANIC USER";

  const action =
    document.createElement("b");

  action.textContent = direction;

  const text =
    document.createElement("span");

  text.textContent = detail;

  const when =
    document.createElement("small");

  when.textContent = timeText();

  row.append(
    badge,
    action,
    text,
    when
  );

  el("pg-log").prepend(row);
}

function stopAuto() {
  if (autoTimer !== null) {
    clearInterval(autoTimer);
    autoTimer = null;
  }

  el("pg-auto-toggle")
    .textContent = "Start Auto";
}

function render() {
  const state = stateName();

  el("pg-mode").textContent =
    model.mode === "classic"
      ? "CLASSIC"
      : model.mode === "auto"
        ? "MAYHEM AUTO"
        : "MAYHEM MANUAL";

  el("pg-state").textContent = state;
  el("pg-time").textContent = timeText();
  el("pg-native").textContent =
    eth(model.nativeReserve);
  el("pg-curve-tokens").textContent =
    number(model.curveTokens, 0);
  el("pg-agent-tokens").textContent =
    number(model.agentTokens, 0);
  el("pg-user-tokens").textContent =
    number(model.userTokens, 0);
  el("pg-organic-volume").textContent =
    eth(model.organicVolume);
  el("pg-agent-volume").textContent =
    eth(model.agentVolume);
  el("pg-agent-trades").textContent =
    String(model.agentTrades);
  el("pg-burned").textContent =
    number(model.burned, 0);
  el("pg-supply").textContent =
    number(totalSupply(), 0);

  const mayhem =
    model.mode !== "classic";

  el("pg-auto-tools").hidden =
    model.mode !== "auto";

  el("pg-manual-tools").hidden =
    model.mode !== "manual";

  el("pg-manual-run").disabled =
    !model.manualPending ||
    !mayhemActive();

  el("pg-manual-request").disabled =
    model.manualPending ||
    !mayhemActive();

  el("pg-finalize").disabled =
    !mayhem ||
    state !== "ENDED" ||
    model.finalized;

  el("pg-auto-one").disabled =
    !mayhemActive();

  el("pg-auto-toggle").disabled =
    !mayhemActive();

  if (
    state !== "ACTIVE"
  ) {
    stopAuto();
  }

  el("pg-manual-status").textContent =
    model.manualPending
      ? "One creator-requested agent trade is pending. Direction and size have not been chosen by you."
      : "No request pending.";

  let status;

  if (model.mode === "classic") {
    status =
      "Classic simulation: no Mayhem inventory or agent trades.";
  } else if (state === "ACTIVE") {
    status =
      "Mayhem is ACTIVE. Organic user volume and Mayhem agent volume are tracked separately.";
  } else if (state === "PAUSED") {
    status =
      "Mayhem is PAUSED because simulated curve backing is below the safety threshold.";
  } else if (model.finalized) {
    status =
      "Mayhem finalized. Unused agent inventory was burned.";
  } else {
    status =
      "Mayhem is ENDED. Finalize to burn unused agent inventory.";
  }

  el("pg-status").textContent =
    status;
}

function selectMode(mode) {
  if (
    !["classic", "auto", "manual"]
      .includes(mode)
  ) {
    return;
  }

  stopAuto();
  selectedMode = mode;

  for (const button of modeButtons) {
    const active =
      button.dataset.mode === mode;

    button.classList.toggle(
      "active",
      active
    );

    button.setAttribute(
      "aria-pressed",
      String(active)
    );
  }

  freshModel();

  el("pg-log").replaceChildren();

  log(
    "user",
    "LAUNCH",
    mode === "classic"
      ? "Classic launched with 1B simulated curve tokens."
      : (
          mode === "auto"
            ? "Mayhem Auto"
            : "Mayhem Manual"
        ) +
        " launched with 1B curve tokens + 1B segregated Mayhem tokens."
  );

  render();
}

function userBuy() {
  const input = 0.05;
  const tokens = quoteBuy(input);

  if (
    tokens <= 0 ||
    tokens >= model.curveTokens
  ) {
    el("pg-status").textContent =
      "Simulated user buy could not execute.";
    return;
  }

  model.nativeReserve += input;
  model.curveTokens -= tokens;
  model.userTokens += tokens;
  model.organicVolume += input;

  log(
    "user",
    "BUY",
    eth(input) +
      " -> " +
      number(tokens, 0) +
      " tokens"
  );

  render();
}

function userSell() {
  if (model.userTokens <= 0) {
    el("pg-status").textContent =
      "Simulate a user buy first so the user has tokens to sell.";
    return;
  }

  const tokens =
    Math.min(
      model.userTokens,
      Math.max(
        1,
        model.userTokens * 0.25
      )
    );

  const output = quoteSell(tokens);

  if (
    output <= 0 ||
    output >= model.nativeReserve
  ) {
    el("pg-status").textContent =
      "Simulated user sell does not have enough curve backing.";
    return;
  }

  model.userTokens -= tokens;
  model.curveTokens += tokens;
  model.nativeReserve -= output;
  model.organicVolume += output;

  log(
    "user",
    "SELL",
    number(tokens, 0) +
      " tokens -> " +
      eth(output)
  );

  render();
}

function runAgentTrade() {
  if (!mayhemActive()) {
    render();
    return;
  }

  if (
    model.agentTrades >=
    MAX_AGENT_TRADES
  ) {
    render();
    return;
  }

  let buy =
    seededRandom() < 0.5;

  const remainingBuy =
    Math.max(
      0,
      MAX_AGENT_BUY_TOTAL -
        model.agentNativeIn
    );

  const remainingSell =
    Math.max(
      0,
      MAX_AGENT_SELL_TOTAL -
        model.agentNativeOut
    );

  if (
    buy &&
    remainingBuy < 0.001
  ) {
    buy = false;
  }

  if (
    !buy &&
    (
      remainingSell <= 0 ||
      model.agentTokens <= 1
    )
  ) {
    buy = true;
  }

  if (buy) {
    const amount =
      Math.min(
        remainingBuy,
        0.001 +
          seededRandom() *
          0.009
      );

    if (amount < 0.001) {
      render();
      return;
    }

    const tokens =
      quoteBuy(amount);

    if (
      tokens <= 0 ||
      tokens >= model.curveTokens
    ) {
      render();
      return;
    }

    model.nativeReserve += amount;
    model.curveTokens -= tokens;
    model.agentTokens += tokens;
    model.agentNativeIn += amount;
    model.agentVolume += amount;
    model.agentTrades += 1;

    log(
      "agent",
      "BUY",
      eth(amount) +
        " -> " +
        number(tokens, 0) +
        " tokens"
    );
  } else {
    const percent =
      0.01 +
      seededRandom() *
      0.04;

    let tokens =
      Math.max(
        1,
        model.agentTokens * percent
      );

    let output =
      quoteSell(tokens);

    if (
      output >
      remainingSell
    ) {
      const ratio =
        remainingSell /
        output;

      tokens *=
        Math.max(
          0,
          Math.min(1, ratio)
        );

      output =
        quoteSell(tokens);
    }

    if (
      tokens <= 0 ||
      output <= 0 ||
      output >= model.nativeReserve ||
      output > remainingSell
    ) {
      render();
      return;
    }

    model.agentTokens -= tokens;
    model.curveTokens += tokens;
    model.nativeReserve -= output;
    model.agentNativeOut += output;
    model.agentVolume += output;
    model.agentTrades += 1;

    log(
      "agent",
      "SELL",
      number(tokens, 0) +
        " tokens -> " +
        eth(output)
    );
  }

  model.hours =
    Math.min(
      MAYHEM_HOURS,
      model.hours + 1 / 6
    );

  render();
}

function requestManual() {
  if (
    model.mode !== "manual" ||
    !mayhemActive()
  ) {
    return;
  }

  model.manualPending = true;

  log(
    "user",
    "REQUEST",
    "Creator requested one randomized Mayhem trade. No direction or size selected."
  );

  render();
}

function runManual() {
  if (
    model.mode !== "manual" ||
    !model.manualPending ||
    !mayhemActive()
  ) {
    return;
  }

  model.manualPending = false;
  runAgentTrade();
}

function toggleAuto() {
  if (
    model.mode !== "auto" ||
    !mayhemActive()
  ) {
    return;
  }

  if (autoTimer !== null) {
    stopAuto();
    return;
  }

  el("pg-auto-toggle")
    .textContent = "Stop Auto";

  autoTimer =
    setInterval(
      () => {
        if (
          model.mode !== "auto" ||
          !mayhemActive()
        ) {
          stopAuto();
          render();
          return;
        }

        runAgentTrade();
      },
      900
    );
}

function addHour() {
  if (
    model.hours <
    MAYHEM_HOURS
  ) {
    model.hours =
      Math.min(
        MAYHEM_HOURS,
        model.hours + 1
      );
  }

  log(
    "user",
    "TIME",
    "Advanced simulated clock to " +
      timeText() +
      "."
  );

  render();
}

function addDay() {
  model.hours =
    MAYHEM_HOURS;

  log(
    "user",
    "TIME",
    "Fast-forwarded simulated Mayhem cycle to 24 hours."
  );

  render();
}

function finalize() {
  if (
    model.mode === "classic" ||
    stateName() !== "ENDED" ||
    model.finalized
  ) {
    return;
  }

  const burn =
    model.agentTokens;

  model.agentTokens = 0;
  model.burned += burn;
  model.finalized = true;
  model.manualPending = false;

  stopAuto();

  log(
    "agent",
    "FINALIZE",
    "Burned " +
      number(burn, 0) +
      " unused Mayhem tokens."
  );

  render();
}

for (const button of modeButtons) {
  button.addEventListener(
    "click",
    () =>
      selectMode(
        button.dataset.mode
      )
  );
}

el("pg-reset").addEventListener(
  "click",
  () => selectMode(selectedMode)
);

el("pg-user-buy").addEventListener(
  "click",
  userBuy
);

el("pg-user-sell").addEventListener(
  "click",
  userSell
);

el("pg-auto-one").addEventListener(
  "click",
  runAgentTrade
);

el("pg-auto-toggle").addEventListener(
  "click",
  toggleAuto
);

el("pg-manual-request").addEventListener(
  "click",
  requestManual
);

el("pg-manual-run").addEventListener(
  "click",
  runManual
);

el("pg-plus-hour").addEventListener(
  "click",
  addHour
);

el("pg-plus-day").addEventListener(
  "click",
  addDay
);

el("pg-finalize").addEventListener(
  "click",
  finalize
);

el("pg-clear-log").addEventListener(
  "click",
  () => el("pg-log").replaceChildren()
);

window.addEventListener(
  "pagehide",
  stopAuto
);

selectMode("classic");