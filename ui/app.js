(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const money = (value) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

  const toast = $("#toast");
  let toastTimer;

  function showToast(message) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2800);
  }

  const spine = $("#spine");
  const margin = $("#margin");
  const scrim = $("#scrim");
  const menuToggle = $("#menu-toggle");
  const clerkToggle = $("#clerk-toggle");

  function syncScrim() {
    const open =
      spine?.classList.contains("is-open") ||
      margin?.classList.contains("is-open");
    scrim?.classList.toggle("is-visible", Boolean(open));
  }

  function closeSpine() {
    spine?.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    syncScrim();
  }

  function closeMargin() {
    margin?.classList.remove("is-open");
    clerkToggle?.setAttribute("aria-expanded", "false");
    syncScrim();
  }

  function toggleSpine() {
    if (!spine) return;
    if (spine.classList.contains("is-open")) {
      closeSpine();
      return;
    }
    closeMargin();
    spine.classList.add("is-open");
    menuToggle?.setAttribute("aria-expanded", "true");
    syncScrim();
  }

  function toggleMargin() {
    if (!margin) return;
    if (margin.classList.contains("is-open")) {
      closeMargin();
      return;
    }
    closeSpine();
    margin.classList.add("is-open");
    clerkToggle?.setAttribute("aria-expanded", "true");
    syncScrim();
  }

  menuToggle?.addEventListener("click", toggleSpine);
  clerkToggle?.addEventListener("click", toggleMargin);
  $("#close-margin")?.addEventListener("click", closeMargin);
  scrim?.addEventListener("click", () => {
    closeSpine();
    closeMargin();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSpine();
      closeMargin();
    }
  });

  $$(".nav__item").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 860px)").matches) closeSpine();
    });
  });

  const orgButton = $("#org-button");
  const orgMenu = $("#org-menu");

  orgButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!orgMenu) return;
    const open = orgMenu.hidden;
    orgMenu.hidden = !open;
    orgButton.setAttribute("aria-expanded", String(open));
  });

  document.addEventListener("click", (event) => {
    if (!orgMenu || event.target.closest(".org")) return;
    orgMenu.hidden = true;
    orgButton?.setAttribute("aria-expanded", "false");
  });

  $$(".org__option").forEach((option) => {
    option.addEventListener("click", () => {
      if (orgMenu) orgMenu.hidden = true;
      orgButton?.setAttribute("aria-expanded", "false");
      if (option.dataset.org !== "Acme Services Co.") {
        showToast("Nimbus Retail LLC is seeded but not part of this UI sample.");
      }
    });
  });

  document.addEventListener("click", (event) => {
    const switchButton = event.target.closest(".switch");
    if (!switchButton) return;
    const checked = switchButton.getAttribute("aria-checked") === "true";
    switchButton.setAttribute("aria-checked", String(!checked));
    showToast(
      !checked
        ? switchButton.dataset.on || "Setting updated."
        : switchButton.dataset.off || "Setting updated.",
    );
  });

  $$("[data-toast]").forEach((element) => {
    element.addEventListener("click", (event) => {
      if (element.tagName === "A" && element.getAttribute("href") === "#") {
        event.preventDefault();
      }
      showToast(element.dataset.toast);
    });
  });

  $$("form[data-search]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      showToast("Search is not part of this UI sample.");
    });
  });

  $$("[data-dismiss-note]").forEach((button) => {
    button.addEventListener("click", () => {
      const note = button.closest(".margin-note");
      if (note) note.hidden = true;
      showToast("Parked for later.");
    });
  });

  $$("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      $$("[data-range]").forEach((candidate) => {
        candidate.setAttribute(
          "aria-pressed",
          String(candidate === button),
        );
      });
      if (button.dataset.range !== "30") {
        showToast("Only the 30-day view is included in this sample.");
      }
    });
  });

  function activateAgentTab(name) {
    const tabs = $$(".agent-tabs .tab");
    if (!tabs.length) return;
    const valid = tabs.some((tab) => tab.dataset.tab === name);
    const target = valid ? name : "ask";
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === target;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$("[data-agent-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.agentPanel !== target;
    });
    try {
      history.replaceState(null, "", `#${target}`);
    } catch (error) {
      return;
    }
  }

  $$(".agent-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => activateAgentTab(tab.dataset.tab));
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest("[data-goto-tab]");
    if (!link) return;
    event.preventDefault();
    activateAgentTab(link.dataset.gotoTab);
  });

  window.addEventListener("hashchange", () => {
    const hash = location.hash.replace("#", "");
    if (["ask", "automations", "approvals", "activity"].includes(hash)) {
      activateAgentTab(hash);
    }
  });

  if ($(".agent-tabs")) {
    const hash = location.hash.replace("#", "");
    activateAgentTab(
      ["ask", "automations", "approvals", "activity"].includes(hash)
        ? hash
        : "ask",
    );
  }

  const invoiceData = {
    "1042": {
      number: "1042",
      customer: "Northwind Supply",
      status: "Overdue",
      issued: "Oct 1, 2026",
      sent: "Oct 2, 2026",
      due: "Nov 1, 2026",
      address: [
        "Accounts payable",
        "410 Cedar Street",
        "Portland, OR 97205",
      ],
      lines: [["Consulting, October", "32 h", "$150.00", 4800]],
      tax: 0,
      total: 4800,
      payment: "No payments recorded.",
    },
    "1041": {
      number: "1041",
      customer: "Harbor Studio",
      status: "Sent",
      issued: "Sep 28, 2026",
      sent: "Sep 28, 2026",
      due: "Nov 27, 2026",
      address: [
        "Accounts payable",
        "88 Pier Avenue",
        "Seattle, WA 98104",
      ],
      lines: [["Brand system", "1", "$3,200.00", 3200]],
      tax: 0,
      total: 3200,
      payment: "No payments recorded.",
    },
    "1040": {
      number: "1040",
      customer: "Meridian Foods",
      status: "Sent",
      issued: "Sep 24, 2026",
      sent: "Sep 25, 2026",
      due: "Nov 23, 2026",
      address: [
        "Accounts payable",
        "22 Orchard Lane",
        "Madison, WI 53703",
      ],
      lines: [
        ["Packaging design", "1", "$2,200.00", 2200],
        ["Production supervision", "4 h", "$110.00", 440],
      ],
      tax: 0,
      total: 2640,
      payment: "No payments recorded.",
    },
    "1039": {
      number: "1039",
      customer: "Juniper Design",
      status: "Sent",
      issued: "Sep 20, 2026",
      sent: "Sep 21, 2026",
      due: "Nov 19, 2026",
      address: [
        "Accounts payable",
        "9 Willow Court",
        "Austin, TX 78701",
      ],
      lines: [["Website build", "1", "$5,280.00", 5280]],
      tax: 0,
      total: 5280,
      payment: "No payments recorded.",
    },
    "1038": {
      number: "1038",
      customer: "Northwind Supply",
      status: "Sent",
      issued: "Sep 15, 2026",
      sent: "Sep 16, 2026",
      due: "Nov 14, 2026",
      address: [
        "Accounts payable",
        "410 Cedar Street",
        "Portland, OR 97205",
      ],
      lines: [["Consulting, September", "1", "$1,000.00", 1000]],
      tax: 0,
      total: 1000,
      payment: "No payments recorded.",
    },
    "1034": {
      number: "1034",
      customer: "Juniper Design",
      status: "Draft",
      issued: "Sep 3, 2026",
      sent: null,
      due: "Nov 17, 2026",
      address: [
        "Accounts payable",
        "9 Willow Court",
        "Austin, TX 78701",
      ],
      lines: [["Brand audit", "1", "$1,500.00", 1500]],
      tax: 0,
      total: 1500,
      payment: "Draft, not sent.",
    },
    "1037": {
      number: "1037",
      customer: "Cedar & Co.",
      status: "Paid",
      issued: "Sep 12, 2026",
      sent: "Sep 12, 2026",
      due: "Oct 12, 2026",
      paidDate: "Oct 10, 2026",
      address: [
        "Accounts payable",
        "31 Kiln Road",
        "Portland, ME 04101",
      ],
      lines: [["Illustration set", "1", "$2,300.00", 2300]],
      tax: 0,
      total: 2300,
      payment: "Paid in full on Oct 10, 2026.",
    },
    "1036": {
      number: "1036",
      customer: "Meridian Foods",
      status: "Paid",
      issued: "Sep 8, 2026",
      sent: "Sep 8, 2026",
      due: "Oct 8, 2026",
      paidDate: "Oct 6, 2026",
      address: [
        "Accounts payable",
        "22 Orchard Lane",
        "Madison, WI 53703",
      ],
      lines: [["Label design", "1", "$1,860.00", 1860]],
      tax: 0,
      total: 1860,
      payment: "Paid in full on Oct 6, 2026.",
    },
    "1033": {
      number: "1033",
      customer: "Meridian Foods",
      status: "Paid",
      issued: "Aug 30, 2026",
      sent: "Aug 30, 2026",
      due: "Sep 30, 2026",
      paidDate: "Sep 29, 2026",
      address: [
        "Accounts payable",
        "22 Orchard Lane",
        "Madison, WI 53703",
      ],
      lines: [["Consulting, September", "1", "$8,440.00", 8440]],
      tax: 0,
      total: 8440,
      payment: "Paid in full on Sep 29, 2026.",
    },
  };

  const statusClass = {
    Overdue: "status--overdue",
    Sent: "status--sent",
    Paid: "status--paid",
    Draft: "status--draft",
  };

  function renderTimeline(data) {
    const timeline = $("#detail-timeline");
    if (!timeline) return;
    const events = [
      { label: "Draft", date: data.issued, done: true },
      {
        label: "Sent",
        date: data.sent || "Not sent",
        done: Boolean(data.sent),
      },
      {
        label: "Due",
        date: data.due,
        done: data.status === "Paid" || data.status === "Overdue",
      },
    ];
    if (data.status === "Paid") {
      events.push({ label: "Paid", date: data.paidDate, done: true });
    }
    if (data.status === "Overdue") {
      events.push({
        label: "Overdue",
        date: "Nov 13, 2026",
        done: true,
        overdue: true,
      });
    }
    timeline.innerHTML = events
      .map(
        (event) =>
          `<div class="timeline__item${event.done ? " is-done" : ""}${
            event.overdue ? " is-overdue" : ""
          }"><div class="timeline__date">${event.date}</div><div class="timeline__label">${event.label}</div></div>`,
      )
      .join("");
  }

  function selectInvoice(id) {
    const data = invoiceData[id];
    if (!data) return;

    $$(".invoice-row").forEach((row) => {
      const selected = row.dataset.invoice === id;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
    });

    const number = $("#detail-number");
    const customer = $("#detail-customer");
    const issued = $("#detail-issued");
    const due = $("#detail-due");
    const status = $("#detail-status");
    const lines = $("#detail-lines");
    const subtotal = $("#detail-subtotal");
    const tax = $("#detail-tax");
    const total = $("#detail-total");
    const payment = $("#detail-payment");
    const address = $("#detail-address");

    if (number) number.textContent = `Invoice #${data.number}`;
    if (customer) customer.textContent = data.customer;
    if (issued) issued.textContent = `Issued ${data.issued}`;
    if (due) due.textContent = `Due ${data.due}`;
    if (status) {
      status.className = `status ${statusClass[data.status] || ""}`;
      status.textContent = "";
      const dot = document.createElement("span");
      dot.className = "dot";
      status.append(dot, document.createTextNode(data.status));
    }
    if (lines) {
      lines.innerHTML = data.lines
        .map(
          (line) =>
            `<tr><td>${line[0]}</td><td class="num">${line[1]}</td><td class="num">${line[2]}</td><td class="num">${money(line[3])}</td></tr>`,
        )
        .join("");
    }
    if (subtotal) subtotal.textContent = money(data.total - data.tax);
    if (tax) tax.textContent = money(data.tax);
    if (total) total.textContent = money(data.total);
    if (payment) payment.textContent = data.payment;
    if (address) {
      address.textContent = "";
      data.address.forEach((line) => {
        const element = document.createElement("div");
        element.className = "party-line";
        element.textContent = line;
        address.appendChild(element);
      });
    }
    renderTimeline(data);
  }

  if ($(".invoice-row")) {
    const params = new URLSearchParams(location.search);
    const requested = params.get("invoice");
    const initial = invoiceData[requested]
      ? requested
      : $(".invoice-row.is-selected")?.dataset.invoice ||
        $(".invoice-row")?.dataset.invoice;
    if (initial) selectInvoice(initial);

    $$(".invoice-row").forEach((row) => {
      row.addEventListener("click", () => selectInvoice(row.dataset.invoice));
      row.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectInvoice(row.dataset.invoice);
        }
      });
    });

    $$("[data-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const filter = button.dataset.filter;
        $$("[data-filter]").forEach((candidate) => {
          candidate.setAttribute(
            "aria-pressed",
            String(candidate === button),
          );
        });
        let firstVisible = null;
        $$(".invoice-row").forEach((row) => {
          const visible =
            filter === "all" || row.dataset.status === filter;
          row.hidden = !visible;
          if (visible && !firstVisible) firstVisible = row;
        });
        const selected = $(".invoice-row.is-selected");
        if ((!selected || selected.hidden) && firstVisible) {
          selectInvoice(firstVisible.dataset.invoice);
        }
      });
    });

    $("#print-invoice")?.addEventListener("click", () => window.print());
  }

  const reconciliation = {
    statement: 42180.22,
    cleared: 40920.22,
    finished: false,
  };

  function updateReconciliation() {
    const difference =
      Math.round((reconciliation.statement - reconciliation.cleared) * 100) /
      100;
    const cleared = $("#cleared-value");
    const differenceValue = $("#difference-value");
    const finish = $("#finish-reconcile");
    const applyAll = $("[data-apply-all]");
    const note = $("#match-note");
    const remaining = $$(".js-match:not(.is-matched)").length;

    if (cleared) cleared.textContent = money(reconciliation.cleared);
    if (differenceValue) {
      differenceValue.textContent = money(difference);
      differenceValue.classList.toggle("is-balanced", difference === 0);
      differenceValue.classList.toggle("is-difference", difference !== 0);
    }
    if (finish) finish.disabled = difference !== 0 || reconciliation.finished;
    if (applyAll) applyAll.disabled = remaining === 0;
    if (note) {
      if (reconciliation.finished) {
        note.textContent =
          "This account is reconciled through Nov 12. You can still review the matched transactions.";
      } else if (difference === 0) {
        note.textContent =
          "All three matches are applied. The account is balanced. Finish when you are ready.";
      } else {
        note.textContent = `I found ${remaining} ${
          remaining === 1 ? "match" : "matches"
        } for the Nov 12 deposits. Applying them will bring the difference to $0.00.`;
      }
    }
  }

  $$(".js-match").forEach((button) => {
    button.addEventListener("click", () => {
      if (
        button.classList.contains("is-matched") ||
        reconciliation.finished
      ) {
        return;
      }
      const amount = Number(button.dataset.amount);
      reconciliation.cleared =
        Math.round((reconciliation.cleared + amount) * 100) / 100;
      button.classList.add("is-matched");
      const cell = button.closest("td");
      if (cell) {
        cell.innerHTML =
          '<span class="status status--paid"><span class="dot"></span>Matched</span>';
      }
      showToast(`Matched to ${button.dataset.target || "the record"}.`);
      updateReconciliation();
    });
  });

  $("[data-apply-all]")?.addEventListener("click", () => {
    $$(".js-match:not(.is-matched)").forEach((button) => button.click());
  });

  $("[data-review-match]")?.addEventListener("click", () => {
    closeMargin();
    $(".js-match:not(.is-matched)")?.focus();
  });

  $("#finish-reconcile")?.addEventListener("click", () => {
    const difference =
      Math.round((reconciliation.statement - reconciliation.cleared) * 100) /
      100;
    if (difference !== 0 || reconciliation.finished) return;
    reconciliation.finished = true;
    const button = $("#finish-reconcile");
    if (button) {
      button.textContent = "Reconciled";
      button.disabled = true;
    }
    $("#step-match")?.classList.remove("is-active");
    $("#step-match")?.classList.add("is-done");
    $("#step-finish")?.classList.add("is-active");
    showToast("Checking 2480 is reconciled through Nov 12.");
    updateReconciliation();
  });

  if ($("#difference-value")) updateReconciliation();

  const penIcon =
    '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  const checkIcon =
    '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const closeIcon =
    '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  const transcript = $("#transcript");
  const askForm = $("#ask-form");
  const askInput = $("#ask-input");
  const slashMenu = $("#slash-menu");
  const slashItems = slashMenu ? $$("[data-slash-command]", slashMenu) : [];
  const slashEmpty = $("#slash-menu-empty");
  const composerModel = $("#composer-model");
  let slashMatches = [];
  let slashIndex = -1;
  let slashOpen = false;

  function slashQueryForInput() {
    if (!askInput) return null;
    const caret = askInput.selectionStart ?? askInput.value.length;
    const before = askInput.value.slice(0, caret);
    const match = before.match(/^\/([a-z]*)$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function setSlashActive(index) {
    if (!slashMatches.length) {
      slashIndex = -1;
      askInput?.removeAttribute("aria-activedescendant");
      return;
    }
    slashIndex = (index + slashMatches.length) % slashMatches.length;
    slashMatches.forEach((item, itemIndex) => {
      const active = itemIndex === slashIndex;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", String(active));
    });
    const active = slashMatches[slashIndex];
    if (active?.id) askInput?.setAttribute("aria-activedescendant", active.id);
    active?.scrollIntoView({ block: "nearest" });
  }

  function showSlashMenu(query) {
    if (!slashMenu || !askInput) return;
    slashMatches = slashItems.filter((item) =>
      (item.dataset.slashCommand || "").startsWith(query),
    );
    slashItems.forEach((item) => {
      const visible = slashMatches.includes(item);
      item.hidden = !visible;
      if (!visible) {
        item.classList.remove("is-active");
        item.setAttribute("aria-selected", "false");
      }
    });
    if (slashEmpty) slashEmpty.hidden = slashMatches.length > 0;
    slashMenu.hidden = false;
    slashOpen = true;
    askInput.setAttribute("aria-expanded", "true");
    setSlashActive(0);
  }

  function closeSlashMenu() {
    slashOpen = false;
    slashIndex = -1;
    slashMatches = [];
    if (slashMenu) slashMenu.hidden = true;
    askInput?.setAttribute("aria-expanded", "false");
    askInput?.removeAttribute("aria-activedescendant");
    slashItems.forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-selected", "false");
    });
  }

  function runSlashCommand(command) {
    closeSlashMenu();
    if (askInput) askInput.value = "";
    if (command === "model") {
      openModelDialog();
      return;
    }
    if (command === "cron" || command === "event") {
      openAutomationFromCommand(command);
    }
  }

  function chooseSlashCommand(item) {
    if (!item) return;
    runSlashCommand(item.dataset.slashCommand || "");
  }

  function scrollToLatest() {
    const latest = transcript?.lastElementChild;
    latest?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }

  function appendUserMessage(text) {
    if (!transcript) return;
    const message = document.createElement("div");
    message.className = "msg msg--user";
    const body = document.createElement("div");
    body.className = "msg__body";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "You: ";
    const content = document.createElement("span");
    content.textContent = text;
    body.append(label, content);
    const avatar = document.createElement("div");
    avatar.className = "avatar avatar--sm";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "MC";
    message.append(body, avatar);
    transcript.appendChild(message);
  }

  function appendClerkMessage(html) {
    if (!transcript) return;
    const message = document.createElement("div");
    message.className = "msg msg--clerk";
    const icon = document.createElement("div");
    icon.className = "msg__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = penIcon;
    const body = document.createElement("div");
    body.className = "msg__body";
    const label = document.createElement("span");
    label.className = "sr-only";
    label.textContent = "Clerk: ";
    const content = document.createElement("div");
    content.innerHTML = html;
    body.append(label, content);
    message.append(icon, body);
    transcript.appendChild(message);
  }

  function responseFor(query) {
    const text = query.toLowerCase();
    if (text.includes("cash")) {
      return '<p>Cash across accounts is <strong>$84,290.16</strong>, up $6,210.00 this month. Checking holds $65,890.16 and savings $18,400.00.</p><p><a class="link" href="reports.html">Open the reports</a></p>';
    }
    if (
      text.includes("reminder") ||
      text.includes("overdue") ||
      text.includes("northwind")
    ) {
      return '<p>Northwind Supply is 12 days late on invoice #1042. I have a reminder ready that includes the invoice PDF and a payment link.</p><p><button class="btn btn--outline btn--sm" type="button" data-goto-tab="approvals">Review the reminder</button></p>';
    }
    if (
      text.includes("categorize") ||
      text.includes("import") ||
      text.includes("match") ||
      text.includes("reconcil")
    ) {
      return '<p>I found three matches for the Nov 12 deposits in checking. Applying them will bring the reconciliation difference to $0.00.</p><p><a class="link" href="reconcile.html">Open reconciliation</a></p>';
    }
    if (
      text.includes("p&l") ||
      text.includes("profit") ||
      text.includes("summary")
    ) {
      return '<p>Net income for Oct 1 to Nov 13 is <strong>$19,356.00</strong>, up 29.6% from the prior period. Revenue is $51,040.00 and expenses are $25,564.00.</p><p><a class="link" href="reports.html">Open the P&amp;L</a></p>';
    }
    return "<p>I can help with that. In this sample, try asking about cash, an overdue reminder, or the latest bank import.</p>";
  }

  function sendMessage(text) {
    appendUserMessage(text);
    scrollToLatest();
    const typing = document.createElement("div");
    typing.className = "msg msg--clerk";
    typing.setAttribute("aria-live", "polite");
    const icon = document.createElement("div");
    icon.className = "msg__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = penIcon;
    const body = document.createElement("div");
    body.className = "msg__body";
    body.innerHTML =
      '<span class="sr-only">Clerk: </span><span class="muted">Checking the books.</span>';
    typing.append(icon, body);
    transcript?.appendChild(typing);
    scrollToLatest();

    window.setTimeout(() => {
      typing.remove();
      appendClerkMessage(responseFor(text));
      scrollToLatest();
    }, reduceMotion ? 80 : 520);
  }

  askForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!askInput) return;
    const query = slashQueryForInput();
    if (slashOpen && query !== null && slashIndex >= 0) {
      chooseSlashCommand(slashMatches[slashIndex]);
      return;
    }
    const text = askInput.value.trim();
    if (!text) return;
    if (text.startsWith("/")) {
      const command = text.slice(1).trim().toLowerCase();
      if (["model", "cron", "event"].includes(command)) {
        runSlashCommand(command);
        return;
      }
      showToast("Unknown command. Try /model, /cron, or /event.");
      return;
    }
    askInput.value = "";
    closeSlashMenu();
    sendMessage(text);
  });

  askInput?.addEventListener("input", () => {
    const query = slashQueryForInput();
    if (query === null) {
      closeSlashMenu();
      return;
    }
    showSlashMenu(query);
  });

  askInput?.addEventListener("focus", () => {
    const query = slashQueryForInput();
    if (query !== null) showSlashMenu(query);
  });

  askInput?.addEventListener("keydown", (event) => {
    if (slashOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashActive(slashIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashActive(slashIndex - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashMenu();
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && slashIndex >= 0) {
        event.preventDefault();
        chooseSlashCommand(slashMatches[slashIndex]);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askForm?.requestSubmit();
    }
  });

  slashMenu?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-slash-command]");
    if (!item || item.hidden) return;
    chooseSlashCommand(item);
  });

  document.addEventListener("click", (event) => {
    if (!slashOpen) return;
    if (event.target.closest("#ask-form")) return;
    closeSlashMenu();
  });

  $$("[data-suggestion]").forEach((button) => {
    button.addEventListener("click", () => {
      if (!askInput) return;
      closeSlashMenu();
      askInput.value = button.dataset.suggestion;
      askForm?.requestSubmit();
    });
  });

  transcript?.addEventListener("click", (event) => {
    const create = event.target.closest("[data-create-draft]");
    if (create) {
      const proposal = create.closest(".proposal");
      const actions = proposal?.querySelector(".proposal__actions");
      if (actions) {
        actions.innerHTML = `<span class="status status--paid">${checkIcon}Draft invoice #1043 created</span> <a class="link" href="invoices.html">Open invoices</a>`;
      }
      showToast("Draft invoice 1043 created.");
      return;
    }
    const dismiss = event.target.closest("[data-dismiss-draft]");
    if (dismiss) {
      const proposal = dismiss.closest(".proposal");
      const actions = proposal?.querySelector(".proposal__actions");
      if (actions) {
        actions.innerHTML =
          '<span class="status status--sent"><span class="dot"></span>No invoice created</span>';
      }
      showToast("Nothing was created.");
    }
  });

  const askParam = new URLSearchParams(location.search).get("ask");
  if (askParam && askForm && askInput && transcript) {
    activateAgentTab("ask");
    askInput.value = askParam;
    window.setTimeout(() => askForm.requestSubmit(), reduceMotion ? 60 : 300);
  }

  function updateApprovalCount() {
    const count = $$('.approval[data-pending="true"]').length;
    ["#approval-count", "#nav-approval-count", "#clerk-approval-count"].forEach(
      (selector) => {
        const element = $(selector);
        if (!element) return;
        element.textContent = String(count);
        element.hidden = count === 0;
      },
    );
    const navLink = $("#nav-clerk-link");
    if (navLink) {
      navLink.setAttribute(
        "aria-label",
        count
          ? `Clerk, ${count} pending approvals`
          : "Clerk",
      );
    }
  }

  $("#approvals-list")?.addEventListener("click", (event) => {
    const approve = event.target.closest("[data-approve]");
    const reject = event.target.closest("[data-reject]");
    if (!approve && !reject) return;
    const approval = event.target.closest(".approval");
    if (!approval) return;
    const actions = approval.querySelector(".approval__actions");
    if (actions) actions.hidden = true;
    approval.dataset.pending = "false";
    const approved = Boolean(approve);
    const result = document.createElement("div");
    result.className =
      "approval__result " +
      (approved
        ? "approval__result--approved"
        : "approval__result--rejected");
    result.innerHTML = approved ? checkIcon : closeIcon;
    result.append(
      document.createTextNode(
        approved
          ? approval.dataset.approved || "Approved."
          : approval.dataset.rejected || "Rejected. Nothing was sent.",
      ),
    );
    approval.appendChild(result);
    showToast(approved ? "Approved." : "Rejected.");
    updateApprovalCount();
  });

  if ($("#approvals-list")) updateApprovalCount();

  const automationDialog = $("#automation-dialog");
  const automationForm = $("#automation-form");
  const automationName = $("#automation-name");
  const automationTrigger = $("#automation-trigger");
  const automationWhen = $("#automation-when");
  const automationTitle = $("#automation-dialog-title");
  let editingAutomation = null;

  function openAutomationDialog(row, options = {}) {
    if (!automationDialog) return;
    editingAutomation = row;
    if (automationTitle) {
      automationTitle.textContent = row
        ? "Edit automation"
        : options.title || "New automation";
    }
    if (automationForm) automationForm.reset();
    if (automationName) automationName.value = row?.dataset.name || "";
    if (automationTrigger) {
      automationTrigger.value =
        row?.dataset.trigger || options.trigger || "schedule";
    }
    if (automationWhen) {
      automationWhen.value = row?.dataset.when || "";
      automationWhen.placeholder =
        automationTrigger?.value === "event"
          ? "When an invoice is 7 days overdue"
          : "Mondays at 9:00";
    }
    automationDialog.showModal();
    window.setTimeout(() => automationName?.focus(), 30);
  }

  function openAutomationFromCommand(mode) {
    const trigger = mode === "event" ? "event" : "schedule";
    activateAgentTab("automations");
    openAutomationDialog(null, {
      trigger,
      title: trigger === "event" ? "New event trigger" : "New routine",
    });
  }

  $("#new-automation")?.addEventListener("click", () =>
    openAutomationDialog(null),
  );

  automationTrigger?.addEventListener("change", () => {
    if (!automationWhen) return;
    automationWhen.placeholder =
      automationTrigger.value === "event"
        ? "When an invoice is 7 days overdue"
        : "Mondays at 9:00";
  });

  $$("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => automationDialog?.close());
  });

  automationDialog?.addEventListener("click", (event) => {
    if (event.target === automationDialog) automationDialog.close();
  });

  function buildAutomationRow(name, trigger, when) {
    const row = document.createElement("div");
    row.className = "automation-row";
    row.dataset.name = name;
    row.dataset.trigger = trigger;
    row.dataset.when = when;

    const info = document.createElement("div");
    const title = document.createElement("div");
    title.className = "automation-row__title";
    title.textContent = name;
    const meta = document.createElement("div");
    meta.className = "automation-row__meta";
    meta.textContent = when;
    info.append(title, meta);

    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.className = "switch";
    switchButton.setAttribute("role", "switch");
    switchButton.setAttribute("aria-checked", "true");
    switchButton.setAttribute("aria-label", `Pause ${name}`);
    switchButton.dataset.on = `${name} resumed.`;
    switchButton.dataset.off = `${name} paused.`;

    const actions = document.createElement("div");
    actions.className = "automation-row__actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "btn btn--ghost btn--sm";
    edit.dataset.edit = "";
    edit.textContent = "Edit";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--ghost btn--sm";
    remove.dataset.delete = "";
    remove.textContent = "Delete";
    actions.append(edit, remove);

    row.append(info, switchButton, actions);
    return row;
  }

  $("#automation-list")?.addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit]");
    if (edit) {
      const row = edit.closest(".automation-row");
      if (row) openAutomationDialog(row);
      return;
    }
    const remove = event.target.closest("[data-delete]");
    if (!remove) return;
    const row = remove.closest(".automation-row");
    if (!row) return;
    if (remove.dataset.confirming === "true") {
      row.remove();
      showToast("Automation deleted.");
      return;
    }
    remove.dataset.confirming = "true";
    remove.textContent = "Delete?";
    window.setTimeout(() => {
      if (!remove.isConnected) return;
      remove.dataset.confirming = "false";
      remove.textContent = "Delete";
    }, 3000);
  });

  automationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = automationName?.value.trim();
    const trigger = automationTrigger?.value || "schedule";
    const when = automationWhen?.value.trim();
    if (!name || !when) return;

    if (editingAutomation) {
      editingAutomation.dataset.name = name;
      editingAutomation.dataset.trigger = trigger;
      editingAutomation.dataset.when = when;
      const title = editingAutomation.querySelector(".automation-row__title");
      const meta = editingAutomation.querySelector(".automation-row__meta");
      if (title) title.textContent = name;
      if (meta) meta.textContent = when;
      const switchButton = editingAutomation.querySelector(".switch");
      if (switchButton) {
        switchButton.setAttribute("aria-label", `Pause ${name}`);
        switchButton.dataset.on = `${name} resumed.`;
        switchButton.dataset.off = `${name} paused.`;
      }
      showToast("Automation updated.");
    } else {
      const row = buildAutomationRow(name, trigger, when);
      $("#automation-list")?.appendChild(row);
      showToast(
        trigger === "event" ? "Event trigger created." : "Routine created.",
      );
    }
    automationDialog?.close();
  });

  const modelDialog = $("#model-dialog");
  const modelForm = $("#model-form");
  const modelOptions = modelForm ? $$('input[name="model"]', modelForm) : [];

  function openModelDialog() {
    if (!modelDialog) return;
    const current = composerModel?.textContent?.trim() || "Gemini Flash";
    modelOptions.forEach((option) => {
      option.checked = option.value === current;
    });
    modelDialog.showModal();
    const selected =
      modelOptions.find((option) => option.checked) || modelOptions[0];
    window.setTimeout(() => selected?.focus(), 30);
  }

  modelForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const selected = modelOptions.find((option) => option.checked);
    if (!selected) return;
    if (composerModel) composerModel.textContent = selected.value;
    modelDialog?.close();
    showToast(`Model set to ${selected.value}.`);
  });

  $$("[data-close-model]").forEach((button) => {
    button.addEventListener("click", () => modelDialog?.close());
  });

  modelDialog?.addEventListener("click", (event) => {
    if (event.target === modelDialog) modelDialog.close();
  });

  $("#activity-filter")?.addEventListener("change", (event) => {
    const value = event.target.value;
    $$("#activity-table tbody tr").forEach((row) => {
      row.hidden = value !== "all" && row.dataset.trigger !== value;
    });
  });

  function exportTable(table, filename) {
    if (!table) return;
    const rows = $$("tr", table).filter((row) => !row.hidden);
    const csv = rows
      .map((row) =>
        $$("th, td", row)
          .map((cell) => `"${cell.innerText.replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
    showToast("CSV exported.");
  }

  $$("[data-export-table]").forEach((button) => {
    button.addEventListener("click", () => {
      exportTable(
        $(button.dataset.exportTable),
        button.dataset.filename || "export.csv",
      );
    });
  });

  function activateReport(name) {
    const tabs = $$(".report-tab");
    if (!tabs.length) return;
    tabs.forEach((tab) => {
      const active = tab.dataset.reportTab === name;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$("[data-report-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.reportPanel !== name;
    });
  }

  $$(".report-tab").forEach((tab) => {
    tab.addEventListener("click", () => activateReport(tab.dataset.reportTab));
  });

  if ($(".report-tab")) {
    activateReport($(".report-tab").dataset.reportTab);
  }

  $("#export-report")?.addEventListener("click", () => {
    const panel = $$("[data-report-panel]").find((item) => !item.hidden);
    exportTable(panel?.querySelector("table"), "report.csv");
  });

  $("#print-report")?.addEventListener("click", () => window.print());

  $("#ask-clerk-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = $("#ask-clerk-input");
    const value = input?.value.trim();
    if (!value) return;
    location.href = `agent.html?ask=${encodeURIComponent(value)}`;
  });
})();
