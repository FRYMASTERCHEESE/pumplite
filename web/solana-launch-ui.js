const reservations =
  new Map();

function short(value) {
  const text =
    String(value || "");

  return text.length > 14
    ? text.slice(0, 6) +
        "…" +
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
      "Creators paid 0 SOL. A first buyer can reserve a browser-local mint with a Phantom message signature. On-chain activation remains safety locked until the final release checks."
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
  transactionsEnabled,
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

  for (
    const launch of
      launches
  ) {
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
        ")"
      );

    const creator =
      make(
        "p",
        "fine",
        "Creator " +
        short(
          launch.creator
        ) +
        " · creator cost 0 SOL"
      );

    const result =
      make(
        "p",
        "fine",
        "Awaiting first buyer."
      );

    const reserve =
      make(
        "button",
        "outline",
        wallet
          ? "Reserve first-buyer mint"
          : "Connect Phantom to reserve"
      );

    reserve.type =
      "button";

    reserve.disabled =
      !wallet;

    const activate =
      make(
        "button",
        "outline",
        transactionsEnabled
          ? "Activation requires final spend-review unlock"
          : "Activation safety locked"
      );

    activate.type =
      "button";

    /*
     * Intentionally fail-closed.
     * This phase exposes the real pending-launch/reservation UI
     * but cannot initiate a paid transaction.
     */
    activate.disabled =
      true;

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
              ". No transaction was submitted.";

            status(
              "First-buyer reservation created with Phantom Sign Message only. No SOL was spent."
            );
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
      activate
    );

    card.append(
      title,
      creator,
      result,
      actions
    );

    list.append(
      card
    );
  }
}
