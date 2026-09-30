const $ = (id) => document.getElementById(id);

let phrasebook = [];
let currentDownloadUrl = null;

function setStatus(id, message) {
  $(id).textContent = message;
}

function normalize(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

// Parse CSV while supporting quoted values and commas inside quotes.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  text = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n") {
      row.push(field.trim());
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }

  if (quoted) {
    throw new Error("Your CSV contains an unclosed quotation mark.");
  }

  row.push(field.trim());
  if (row.some((v) => v !== "")) rows.push(row);

  if (rows.length < 2) {
    throw new Error("The CSV has no translation rows.");
  }

  const headers = rows[0].map((h) => h.trim());
  const required = [
    "Hindi", "Language", "Translation", "Verified", "Verified_By"
  ];

  for (const name of required) {
    if (!headers.includes(name)) {
      throw new Error("Missing required CSV column: " + name);
    }
  }

  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] ?? "";
    });
    return item;
  });
}

// Import only entries marked verified and naming a reviewer.
// These fields do not independently prove translation accuracy.
$("importButton").addEventListener("click", async () => {
  const file = $("csvFile").files[0];

  if (!file) {
    setStatus("importStatus", "Please choose a CSV file first.");
    return;
  }

  try {
    const text = await file.text();
    const entries = parseCSV(text);

    phrasebook = entries.filter((item) =>
      normalize(item.Verified) === "yes" &&
      item.Translation.trim() !== "" &&
      item.Verified_By.trim() !== "" &&
      item.Hindi.trim() !== "" &&
      item.Language.trim() !== ""
    );

    // Store the eligible entries on this device for offline lookup.
    localStorage.setItem(
      "bhashabridge_phrasebook_v1",
      JSON.stringify(phrasebook)
    );

    setStatus(
      "importStatus",
      `Imported ${phrasebook.length} eligible entries.`
    );
  } catch (error) {
    setStatus("importStatus", "Import failed: " + error.message);
  }
});

// Restore the last imported phrasebook when reopening the app.
try {
  const saved = localStorage.getItem("bhashabridge_phrasebook_v1");
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed)) phrasebook = parsed;
  }
} catch (error) {
  phrasebook = [];
}

// Exact phrase and target-language lookup.
// No translation is generated or guessed.
$("lookupButton").addEventListener("click", () => {
  const hindi = $("hindiText").value.trim();
  const language = $("language").value;
  const output = $("translationResult");

  output.replaceChildren();

  if (!hindi) {
    output.textContent = "Please enter a Hindi word or sentence.";
    return;
  }

  const match = phrasebook.find((item) =>
    normalize(item.Hindi) === normalize(hindi) &&
    normalize(item.Language) === normalize(language) &&
    normalize(item.Verified) === "yes" &&
    item.Translation.trim() !== "" &&
    item.Verified_By.trim() !== ""
  );

  if (!match) {
    output.textContent =
      "No eligible phrasebook entry found. No translation was invented.";
    return;
  }

  const heading = document.createElement("h3");
  heading.textContent = language + " translation";

  const translation = document.createElement("p");
  translation.textContent = match.Translation;

  const reviewer = document.createElement("p");
  reviewer.textContent = "CSV reviewer listed: " + match.Verified_By;

  output.append(heading, translation, reviewer);
});

// Create a plain-text worksheet.
$("worksheetButton").addEventListener("click", () => {
  const title =
    $("worksheetTitle").value.trim() || "BhashaBridge-AI Worksheet";
  const content = $("worksheetText").value.trim();

  if (!content) {
    setStatus("connection", "Enter lesson content before preparing a worksheet.");
    return;
  }

  const worksheet = `${title}\n\n${content}\n\nCreated with BhashaBridge-AI\n`;
  const blob = new Blob([worksheet], {
    type: "text/plain;charset=utf-8"
  });

  if (currentDownloadUrl) {
    URL.revokeObjectURL(currentDownloadUrl);
  }

  currentDownloadUrl = URL.createObjectURL(blob);
  const link = $("downloadLink");
  link.href = currentDownloadUrl;
  link.download = "BhashaBridge-Worksheet.txt";
  link.textContent = "Download worksheet";
  link.hidden = false;
});

// Display whether the browser currently reports a network connection.
function updateConnection() {
  $("connection").textContent = navigator.onLine
    ? "Network connection available"
    : "Offline mode: saved app data may be available";
}

window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
updateConnection();

// Register the offline service worker on the deployed HTTPS website.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      $("connection").textContent = "Preparing offline support...";

      await navigator.serviceWorker.register("./sw.js");
      await navigator.serviceWorker.ready;

      $("connection").textContent =
        "Offline support registered. Import your phrasebook while online.";
    } catch (error) {
      $("connection").textContent =
        "Offline setup failed. Please reconnect and reload the app.";
      console.error("Service worker registration failed:", error);
    }
  });
}

/* Hindi speech-to-text feature */
const voiceButton = document.getElementById("voiceButton");
const voiceStatus = document.getElementById("voiceStatus");

const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

let recognition = null;

if (!SpeechRecognition) {
  voiceButton.disabled = true;
  voiceStatus.textContent =
    "Speech recognition is not supported in this browser. Try an updated Chrome browser.";
} else {
  recognition = new SpeechRecognition();
  recognition.lang = "hi-IN";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    voiceButton.textContent = "🎙️ Listening...";
    voiceStatus.textContent = "Please speak in Hindi.";
  };

  recognition.onresult = (event) => {
    const spokenText =
      event.results[0][0].transcript.trim();

    document.getElementById("hindiText").value =
      spokenText;

    voiceStatus.textContent =
      "Recognized text: " + spokenText +
      ". Check the text, then tap Find translation.";
  };

  recognition.onerror = (event) => {
    voiceStatus.textContent =
      "Speech recognition failed: " + event.error +
      ". Check microphone permission and internet connection.";
  };

  recognition.onend = () => {
    voiceButton.textContent = "🎙️ Speak in Hindi";
  };

  voiceButton.addEventListener("click", () => {
    try {
      recognition.start();
    } catch (error) {
      voiceStatus.textContent =
        "Please wait a moment and try the microphone again.";
    }
  });
}

/* =========================================
   PRELOADED HO PHRASEBOOK
   ========================================= */

(async function loadHoPhrasebook() {
  const status = document.getElementById(
    "hoPhrasebookStatus"
  );

  const tableBody = document.getElementById(
    "hoPhrasebookBody"
  );

  const downloadButton = document.getElementById(
    "downloadHoPhrasebook"
  );

  if (!status || !tableBody || !downloadButton) {
    return;
  }

  let verifiedHoEntries = [];

  // Read CSV fields, including fields containing commas.
  function parseHoCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    text = text.replace(/^\uFEFF/, "");

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (ch === '"') {
        if (quoted && text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        row.push(field);
        field = "";
      } else if (
        (ch === "\n" || ch === "\r") && !quoted
      ) {
        if (ch === "\r" && text[i + 1] === "\n") {
          i++;
        }

        row.push(field);

        if (row.some(value => value.trim() !== "")) {
          rows.push(row);
        }

        row = [];
        field = "";
      } else {
        field += ch;
      }
    }

    if (field !== "" || row.length > 0) {
      row.push(field);

      if (row.some(value => value.trim() !== "")) {
        rows.push(row);
      }
    }

    if (rows.length < 2) {
      return [];
    }

    const headers = rows[0].map(value =>
      value.trim().replace(/^\uFEFF/, "").toLowerCase()
    );

    const column = name => headers.indexOf(name);

    const hindiCol = column("hindi");
    const languageCol = column("language");
    const translationCol = column("translation");
    const verifiedCol = column("verified");
    const reviewerCol = column("verified_by");

    const required = [
      hindiCol,
      languageCol,
      translationCol,
      verifiedCol,
      reviewerCol
    ];

    if (required.some(index => index < 0)) {
      throw new Error(
        "CSV must contain Hindi, Language, Translation, " +
        "Verified, and Verified_By columns."
      );
    }

    return rows.slice(1).map(values => ({
      Hindi: (values[hindiCol] || "").trim(),
      Language: (values[languageCol] || "").trim(),
      Translation: (values[translationCol] || "").trim(),
      Verified: (values[verifiedCol] || "").trim(),
      Verified_By: (values[reviewerCol] || "").trim()
    }));
  }

  // Show text safely without interpreting it as HTML.
  function addCell(row, value) {
    const cell = document.createElement("td");
    cell.textContent = value;
    cell.style.padding = "10px";
    cell.style.borderBottom = "1px solid #777";
    row.appendChild(cell);
  }

  function csvEscape(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
  }

  try {
    status.textContent = "Loading Ho phrasebook...";

    // This file is hosted alongside index.html.
    // The service worker will cache it for offline access.
    const response = await fetch("./Ho_Phrasebook.csv");

    if (!response.ok) {
      throw new Error(
        "Could not load Ho_Phrasebook.csv. " +
        "Check that the file exists in your GitHub repository."
      );
    }

    const csvText = await response.text();
    const allEntries = parseHoCSV(csvText);

    // Only eligible Ho translations are displayed/downloaded.
    verifiedHoEntries = allEntries.filter(entry =>
      entry.Language.toLowerCase() === "ho" &&
      entry.Verified.toLowerCase() === "yes" &&
      entry.Hindi !== "" &&
      entry.Translation !== "" &&
      entry.Verified_By !== ""
    );

    tableBody.replaceChildren();

    verifiedHoEntries.forEach(entry => {
      const row = document.createElement("tr");

      addCell(row, entry.Hindi);
      addCell(row, entry.Translation);
      addCell(row, entry.Verified_By);

      tableBody.appendChild(row);
    });

    if (verifiedHoEntries.length === 0) {
      status.textContent =
        "No eligible verified Ho entries were found. " +
        "Check the CSV columns and verification values.";
      return;
    }

    status.textContent =
      verifiedHoEntries.length +
      " verified Ho entries loaded.";

    downloadButton.disabled = false;

  } catch (error) {
    status.textContent = error.message;
    console.error("Ho phrasebook error:", error);
  }

  // Download the verified Ho entries as a separate CSV.
  downloadButton.addEventListener("click", () => {
    if (verifiedHoEntries.length === 0) return;

    const headers = [
      "Hindi",
      "Language",
      "Translation",
      "Verified",
      "Verified_By"
    ];

    const rows = verifiedHoEntries.map(entry => [
      entry.Hindi,
      "Ho",
      entry.Translation,
      "Yes",
      entry.Verified_By
    ]);

    const csv = [
      headers,
      ...rows
    ].map(row => row.map(csvEscape).join(",")).join("\r\n");

    // UTF-8 BOM helps Excel display Hindi correctly.
    const blob = new Blob(
      ["\uFEFF" + csv],
      { type: "text/csv;charset=utf-8;" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "Ho_Phrasebook.csv";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
})();
