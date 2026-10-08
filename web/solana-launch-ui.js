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

let solFiatRates = null;
let solFiatRatesAt = 0;

async function loadSolFiatRates() {
  if (
    solFiatRates &&
    Date.now() - solFiatRatesAt < 60000
  ) {
    return solFiatRates;
  }

  const response = await fetch(
    "https://api.coinbase.com/v2/exchange-rates?currency=SOL",
    {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    }
  );

  if (!response.ok) {
    throw Error("Live fiat estimate unavailable");
  }

  const payload = await response.json();

  const NZD = Number(payload?.data?.rates?.NZD);
  const USD = Number(payload?.data?.rates?.USD);

  if (
    !Number.isFinite(NZD) ||
    !Number.isFinite(USD) ||
    NZD <= 0 ||
    USD <= 0
  ) {
    throw Error("Live fiat estimate unavailable");
  }

  solFiatRates = { NZD, USD };
  solFiatRatesAt = Date.now();

  return solFiatRates;
}

function formatCoinFiat(value, currency) {
  return new Intl.NumberFormat(
    currency === "NZD" ? "en-NZ" : "en-US",
    {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }
  ).format(value);
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
      "New Solana coins ready to buy"
    );

  const help =
    make(
      "p",
      "fine",
      "Creators publish for 0 SOL. Enter how much SOL you want to spend and press Buy Coin. PumpLite handles preparation and activation as part of that normal purchase."
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
        "No new Solana coins are waiting to be bought."
      )
    );

    return;
  }

  const saved =
    savedLaunchIds();

  const orderedLaunches =
    [...launches].sort(
      (a, b) =>
        Number(
          b.registeredAt || 0
        ) -
        Number(
          a.registeredAt || 0
        )
    );

  const newestMineByIdentity =
    new Set();

  let hiddenMineDuplicates =
    0;

  for (
    const launch of
      orderedLaunches
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

    if (mine) {
      const identity =
        [
          String(
            launch.creator || ''
          ),
          String(
            launch.name || ''
          ).toLowerCase(),
          String(
            launch.symbol || ''
          ).toLowerCase()
        ].join('|');

      if (
        newestMineByIdentity.has(
          identity
        )
      ) {
        hiddenMineDuplicates++;
        continue;
      }

      newestMineByIdentity.add(
        identity
      );
    }

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
            ? " - YOUR COIN"
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
        "Coin listing ID: " +
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
          : "Published coin"
      );

    const result =
      make(
        "p",
        "fine",
        "Ready to buy."
      );

    const amountLabel =
      make(
        "label",
        "",
        "Buy amount (SOL)"
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

    const fiatPreview =
      make(
        "p",
        "fine",
        "Enter a SOL amount to see approximate NZD and USD value."
      );

    let fiatSequence = 0;

    const reserve =
      make(
        "button",
        "outline",
        wallet
          ? "Prepare coin purchase"
          : "Connect Phantom to buy"
      );

    reserve.type =
      "button";

    reserve.disabled =
      !wallet;

    const activate =
      make(
        "button",
        "primary",
        transactionsEnabled
          ? wallet
            ? "Buy " + launch.symbol
            : "Connect Phantom to buy"
          : "Solana buying disabled"
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
          "Buy " +
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

        const sequence = ++fiatSequence;

        const solValue =
          Number(buyAmount) /
          1000000000;

        fiatPreview.textContent =
          "Loading approximate NZD / USD value...";

        void loadSolFiatRates()
          .then(rates => {
            if (sequence !== fiatSequence) {
              return;
            }

            fiatPreview.textContent =
              "Approximate value: " +
              formatCoinFiat(
                solValue * rates.NZD,
                "NZD"
              ) +
              " / " +
              formatCoinFiat(
                solValue * rates.USD,
                "USD"
              ) +
              ". Final payment is SOL.";
          })
          .catch(() => {
            if (sequence === fiatSequence) {
              fiatPreview.textContent =
                "NZD / USD estimate temporarily unavailable. The SOL amount is unchanged.";
            }
          });

        activate.disabled =
          !transactionsEnabled ||
          !wallet;
      } catch (error) {
        preview.textContent =
          error.message;

        fiatPreview.textContent =
          "Enter a valid SOL amount.";

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
              "Coin purchase prepared. Review the SOL amount before buying."
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

            if (!reservationReady()) {
              result.textContent =
                "Preparing your coin purchase. The first Phantom request is a free message signature and cannot spend SOL.";

              let prepared;

              try {
                prepared =
                  await adapter.reserveFirstBuyer({
                    launchId:
                      launch.id
                  });
              } catch (error) {
                updatePreview();
                throw error;
              }

              reservations.set(
                launch.id,
                prepared
              );

              status(
                "Coin purchase prepared. PumpLite is checking the real Solana transaction before Phantom approval."
              );
            }

            result.textContent =
              "Checking your Solana coin purchase. Phantom opens only if the transaction passes simulation.";

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
              const message =
                error?.message ||
                "Coin purchase could not complete.";

              result.textContent =
                "Buy was NOT submitted: " +
                message;

              status(
                "Buy was NOT submitted: " +
                message
              );

              updatePreview();

              /*
               * updatePreview changes the quote only. Restore the
               * important failure directly on this coin card.
               */
              result.textContent =
                "Buy was NOT submitted: " +
                message;

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
      fiatPreview,
      actions
    );

    if (mine) void import('./mayhem-ui.js').then(m => m.attachMintAuthorization(card, launch, wallet, adapter, run)).catch(() => {});
    list.append(card);

    updatePreview();
  }

  if (
    hiddenMineDuplicates >
    0
  ) {
    list.prepend(
      make(
        "p",
        "fine",
        "Showing your newest matching coin. " +
          hiddenMineDuplicates +
          " older duplicate coin listing" +
          (
            hiddenMineDuplicates === 1
              ? " is"
              : "s are"
          ) +
          " hidden here. Nothing was deleted."
      )
    );
  }
}
