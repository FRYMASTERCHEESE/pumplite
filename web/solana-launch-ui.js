const reservations =
  new Map();

const LAMPORTS_PER_SOL =
  1_000_000_000n;

const TOKEN_SCALE =
  1_000_000n;

const TINY_SUPPLY =
  1_000_000_000_000_000n;

const VIRTUAL_SOL =
  30_000_000_000n;

function short(value) {
  const text =
    String(value || "");

  return text.length > 14
    ? text.slice(0, 6) +
        "..." +
        text.slice(-5)
    : text;
}

function make(
  tag,
  className,
  text
) {
  const node =
    document.createElement(
      tag
    );

  if (className) {
    node.className =
      className;
  }

  if (
    text !== undefined
  ) {
    node.textContent =
      text;
  }

  return node;
}

function savedLaunchIds() {
  try {
    const value =
      JSON.parse(
        localStorage.getItem(
          "pumplite.solana.freeLaunchDrafts.v1"
        ) ||
        "[]"
      );

    return new Set(
      Array.isArray(value)
        ? value
            .map(item =>
              item?.id
            )
            .filter(id =>
              typeof id ===
              "string"
            )
        : []
    );
  } catch {
    return new Set();
  }
}

function parseSol(value) {
  const text =
    String(value || "")
      .trim();

  const match =
    /^(0|[1-9][0-9]*)(?:\.([0-9]{1,9}))?$/
      .exec(text);

  if (!match) {
    throw Error(
      "Enter a valid SOL amount with no more than 9 decimal places."
    );
  }

  const whole =
    BigInt(
      match[1]
    );

  const fraction =
    BigInt(
      (match[2] || "")
        .padEnd(9, "0")
    );

  const lamports =
    whole *
      LAMPORTS_PER_SOL +
    fraction;

  if (
    lamports <= 0n ||
    lamports >
      18_446_744_073_709_551_615n
  ) {
    throw Error(
      "First-buy SOL amount is outside the supported range."
    );
  }

  return lamports;
}

function formatSol(
  value
) {
  const whole =
    value /
    LAMPORTS_PER_SOL;

  const fraction =
    (
      value %
      LAMPORTS_PER_SOL
    )
      .toString()
      .padStart(
        9,
        "0"
      )
      .replace(
        /0+$/,
        ""
      );

  return (
    whole.toString() +
    (
      fraction
        ? "." +
          fraction
        : ""
    )
  );
}

function formatTokens(
  value
) {
  const whole =
    value /
    TOKEN_SCALE;

  const fraction =
    (
      value %
      TOKEN_SCALE
    )
      .toString()
      .padStart(
        6,
        "0"
      )
      .replace(
        /0+$/,
        ""
      );

  return (
    whole.toLocaleString(
      "en-NZ"
    ) +
    (
      fraction
        ? "." +
          fraction
        : ""
    )
  );
}

function firstBuyerQuote(
  buyAmount
) {
  const fee =
    buyAmount /
    400n;

  const net =
    buyAmount -
    fee;

  const output =
    TINY_SUPPLY *
    net /
    (
      VIRTUAL_SOL +
      net
    );

  const minimum =
    output *
    99n /
    100n;

  if (
    output <= 0n ||
    minimum <= 0n
  ) {
    throw Error(
      "First-buy amount is too small."
    );
  }

  return {
    fee,
    output,
    minimum
  };
}

function ensureSection(
  anchor
) {
  let section =
    document.getElementById(
      "solana-pending-launch-section"
    );

  if (section) {
    return section;
  }

  section =
    make(
      "section",
      "solana-pending-launches"
    );

  section.id =
    "solana-pending-launch-section";

  const heading =
    make(
      "h3",
      "",
      "Free Solana launches awaiting first buyer"
    );

  const help =
    make(
      "p",
      "fine",
      "Creators launch for 0 SOL. The first buyer funds the real Solana Mainnet mint, market activation and first purchase. PumpLite simulates the transaction before Phantom asks for approval."
    );

  const list =
    make(
      "div",
      "market-list"
    );

  list.id =
    "solana-pending-launch-list";

  section.append(
    heading,
    help,
    list
  );

  anchor.parentElement
    ?.insertBefore(
      section,
      anchor
    );

  return section;
}

export function
renderPendingLaunches({
  anchor,
  launches,
  adapter,
  wallet,
  treasury,
  transactionsEnabled,
  refresh,
  run,
  status
}) {
  if (!anchor) {
    return;
  }

  const section =
    ensureSection(
      anchor
    );

  const list =
    section.querySelector(
      "#solana-pending-launch-list"
    );

  list.replaceChildren();

  if (
    !Array.isArray(
      launches
    ) ||
    launches.length === 0
  ) {
    list.append(
      make(
        "p",
        "empty",
        "No free Solana launches are waiting for a first buyer."
      )
    );

    return;
  }

  const saved =
    savedLaunchIds();

  for (
    const launch of
      launches
  ) {
    const mine =
      saved.has(
        launch.id
      ) ||
      (
        wallet &&
        wallet ===
          launch.creator
      );

    const treasuryBuyer =
      Boolean(
        wallet &&
        treasury &&
        wallet ===
          treasury
      );

    const card =
      make(
        "article",
        "token-market-card"
      );

    const title =
      make(
        "b",
        "",
        launch.name +
        " (" +
        launch.symbol +
        ")" +
        (
          mine
            ? " - YOUR LAUNCH"
            : ""
        )
      );

    const creator =
      make(
        "p",
        "fine",
        "Creator " +
        short(
          launch.creator
        ) +
        " - creator cost 0 SOL"
      );

    const launchId =
      make(
        "p",
        "fine",
        "Launch ID: " +
        launch.id
      );

    const registered =
      make(
        "p",
        "fine",
        Number.isFinite(
          Number(
            launch.registeredAt
          )
        )
          ? "Published " +
            new Date(
              Number(
                launch.registeredAt
              )
            ).toLocaleString()
          : "Published launch"
      );

    const result =
      make(
        "p",
        "fine",
        treasuryBuyer
          ? "This connected wallet is the PumpLite treasury and cannot be the first buyer. Connect a different Phantom wallet."
          : "Awaiting first buyer."
      );

    const amountLabel =
      make(
        "label",
        "",
        "First buy amount (SOL)"
      );

    const amount =
      make(
        "input",
        ""
      );

    amount.type =
      "text";

    amount.inputMode =
      "decimal";

    amount.value =
      "0.001";

    amount.placeholder =
      "0.001";

    amount.autocomplete =
      "off";

    const preview =
      make(
        "p",
        "fine"
      );

    const reserve =
      make(
        "button",
        "outline",
        treasuryBuyer
          ? "Use a different Phantom wallet"
          : wallet
            ? "Reserve first-buyer mint"
            : "Connect Phantom to reserve"
      );

    reserve.type =
      "button";

    reserve.disabled =
      !wallet ||
      treasuryBuyer;

    const activate =
      make(
        "button",
        "primary",
        transactionsEnabled
          ? "Review activation + first buy in Phantom"
          : "Solana activation disabled"
      );

    activate.type =
      "button";

    activate.disabled =
      true;

    const sync =
      make(
        "button",
        "outline",
        "Retry registry sync"
      );

    sync.type =
      "button";

    sync.hidden =
      true;

    function reservationReady() {
      const value =
        reservations.get(
          launch.id
        );

      return Boolean(
        value &&
        wallet &&
        value.buyer ===
          wallet &&
        Number.isSafeInteger(
          value.expiresAt
        ) &&
        value.expiresAt >
          Date.now() +
          15_000
      );
    }

    function updatePreview() {
      try {
        const buyAmount =
          parseSol(
            amount.value
          );

        const quote =
          firstBuyerQuote(
            buyAmount
          );

        preview.textContent =
          "First purchase " +
          formatSol(
            buyAmount
          ) +
          " SOL -> approximately " +
          formatTokens(
            quote.output
          ) +
          " " +
          launch.symbol +
          ". PumpLite's 0.25% trading fee is included in the buy amount. Solana account rent and the network transaction fee are additional. PumpLite simulates the complete transaction before Phantom asks you to sign.";

        activate.disabled =
          !transactionsEnabled ||
          !wallet ||
          treasuryBuyer ||
          !reservationReady();
      } catch (error) {
        preview.textContent =
          error.message;

        activate.disabled =
          true;
      }
    }

    amount.addEventListener(
      "input",
      updatePreview
    );

    reserve.addEventListener(
      "click",
      () => {
        run(
          async () => {
            const reserved =
              await adapter
                .reserveFirstBuyer({
                  launchId:
                    launch.id
                });

            reservations.set(
              launch.id,
              reserved
            );

            result.textContent =
              "Reserved mint " +
              short(
                reserved.mint
              ) +
              " until " +
              new Date(
                reserved.expiresAt
              ).toLocaleTimeString() +
              ". This reservation used Phantom Sign Message only. No transaction was submitted and no SOL was spent.";

            reserve.textContent =
              "Reserve again";

            status(
              "First-buyer reservation ready. Review the SOL amount before activation."
            );

            updatePreview();
          }
        );
      }
    );

    activate.addEventListener(
      "click",
      () => {
        run(
          async () => {
            const buyAmount =
              parseSol(
                amount.value
              );

            const quote =
              firstBuyerQuote(
                buyAmount
              );

            activate.disabled =
              true;

            result.textContent =
              "Running the Solana Mainnet pre-sign simulation. Phantom opens only if the PumpLite transaction passes.";

            let submitted;

            try {
              submitted =
                await adapter
                  .activateReservedFirstBuyer({
                    launchId:
                      launch.id,
                    buyAmount,
                    buyMinimum:
                      quote.minimum
                  });
            } catch (error) {
              updatePreview();
              throw error;
            }

            result.textContent =
              "Solana transaction confirmed: " +
              short(
                submitted.signature
              ) +
              ". Syncing the PumpLite launch registry.";

            let finalized;

            try {
              finalized =
                await adapter
                  .retryFinalizeFirstBuyer({
                    launchId:
                      launch.id
                  });
            } catch {
              sync.hidden =
                false;

              result.textContent =
                "The Solana activation transaction is confirmed, but the PumpLite registry still needs to sync. DO NOT submit another activation. Use Retry registry sync.";

              status(
                "On-chain activation confirmed. Registry synchronization still needs retry."
              );

              return;
            }

            amount.disabled =
              true;

            reserve.disabled =
              true;

            activate.disabled =
              true;

            sync.hidden =
              true;

            result.textContent =
              "ACTIVATED - mint " +
              short(
                finalized.mint
              ) +
              ". The market is now live on Solana Mainnet.";

            status(
              launch.name +
              " (" +
              launch.symbol +
              ") activated on Solana Mainnet."
            );

            if (
              typeof refresh ===
              "function"
            ) {
              await refresh();
            }
          }
        );
      }
    );

    sync.addEventListener(
      "click",
      () => {
        run(
          async () => {
            const finalized =
              await adapter
                .retryFinalizeFirstBuyer({
                  launchId:
                    launch.id
                });

            amount.disabled =
              true;

            reserve.disabled =
              true;

            activate.disabled =
              true;

            sync.hidden =
              true;

            result.textContent =
              "ACTIVATED - mint " +
              short(
                finalized.mint
              ) +
              ". Registry sync completed.";

            status(
              launch.name +
              " registry synchronization completed."
            );

            if (
              typeof refresh ===
              "function"
            ) {
              await refresh();
            }
          }
        );
      }
    );

    const actions =
      make(
        "div",
        "market-actions"
      );

    actions.append(
      reserve,
      activate,
      sync
    );

    card.append(
      title,
      creator,
      launchId,
      registered,
      result,
      amountLabel,
      amount,
      preview,
      actions
    );

    list.append(
      card
    );

    updatePreview();
  }
}
