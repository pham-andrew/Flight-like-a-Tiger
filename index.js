/**
 * Author: Michael Hadley, mikewesthad.com
 * Asset Credits:
 *  - Tuxemon, https://github.com/Tuxemon/Tuxemon
 */

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: "game-container",
  pixelArt: true,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 },
    },
  },
  scene: {
    preload: preload,
    create: create,
    update: update,
  },
};

const game = new Phaser.Game(config);
let cursors;
let interactKey;
let spaceKey;
let player;
let showDebug = false;
let consoleText;
let interactableNpcs = [];
let chapter = 0;
let activeChapterDialog = null;
let defaultDialogMessage = 'Arrow keys to move\nPress "F" to interact\nPress "D" to show hitboxes';
let consoleHistory = [];
let consoleScrollOffset = 0;
let consoleInput = "";
let isConsoleTyping = false;
let commandKeyListener;
const consoleVisibleLines = 4;
const consoleMaxHistory = 250;
let mapTileWidth = 32;
let mapTileHeight = 32;
const inventory = new Map();
let dialogPitchConfig = { default: 200 };
const dialogSpeechState = {
  lineToken: 0,
  voices: new Set(),
};
const itemDefinitions = {
  staffofmisfire: {
    name: "Staff of Misfire",
    description: "A Glock taped securely to the end of a broom handle.",
  },
  studentid: {
    name: "Student ID",
    description: "A hand penned piece of paper with the Tereura School of Magic Hanko Stamp.",
  },
};
const mapFilePath = "../assets/town.tmx";
const masterVolume = 0.5;
const chapterDialogSoundState = {
  loaded: new Set(),
  loading: new Set(),
};

function normalizeItemId(itemId) {
  return (itemId || "").trim().toLowerCase();
}

function getItemDefinition(itemId) {
  return itemDefinitions[normalizeItemId(itemId)] || null;
}

function getItemDefinitionByName(itemName) {
  const normalizedName = (itemName || "").trim().toLowerCase();

  if (!normalizedName) {
    return null;
  }

  return (
    Object.values(itemDefinitions).find((item) => item.name.toLowerCase() === normalizedName) || null
  );
}

function normalizeSpeakerName(speakerName) {
  return (speakerName || "").trim().toLowerCase();
}

function getItemIdByName(itemName) {
  const normalizedName = (itemName || "").trim().toLowerCase();

  if (!normalizedName) {
    return null;
  }

  const matchingEntry = Object.entries(itemDefinitions).find(
    ([itemId, itemDefinition]) =>
      itemId.toLowerCase() === normalizedName || itemDefinition.name.toLowerCase() === normalizedName,
  );

  return matchingEntry ? matchingEntry[0] : null;
}

function parseDialogPitchConfig(rawPitchText) {
  const pitchConfig = { default: 200 };

  (rawPitchText || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const pitchMatch = line.match(/^([A-Za-z0-9_-]+)\s*[:=]\s*(-?\d+(?:\.\d+)?)$/u);
      if (!pitchMatch) {
        return;
      }

      const speakerName = normalizeSpeakerName(pitchMatch[1]);
      const pitchValue = Number(pitchMatch[2]);

      if (speakerName && Number.isFinite(pitchValue)) {
        pitchConfig[speakerName] = pitchValue;
      }
    });

  return pitchConfig;
}

function getDialogBasePitch(speakerName) {
  const normalizedSpeakerName = normalizeSpeakerName(speakerName);
  return dialogPitchConfig[normalizedSpeakerName] ?? dialogPitchConfig.default ?? 200;
}

function shortenAnimaleseText(script) {
  return (script || "")
    .replace(/[^a-z]/gi, " ")
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 1 ? `${word[0]}${word[word.length - 1]}` : word))
    .join("");
}

function getAnimaleseCharacterTone(character, pitch) {
  const upperCharacter = character.toUpperCase();
  const letterIndex = upperCharacter.charCodeAt(0) - 65;
  const normalizedPitch = Number.isFinite(pitch) ? pitch : 200;
  const letterVariation = (letterIndex - 12) * 6;
  const outputFrequency = Math.max(80, normalizedPitch + letterVariation);

  return {
    outputFrequency,
    isVowel: /[AEIOU]/u.test(upperCharacter),
  };
}

function playAnimaleseSyllable(scene, tone, startDelayMs, durationMs, lineToken) {
  scene.time.delayedCall(startDelayMs, () => {
    if (lineToken !== dialogSpeechState.lineToken) {
      return;
    }

    const context = scene.sound?.context;
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      context.resume();
    }

    const startTime = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = tone.isVowel ? "triangle" : "square";
    oscillator.frequency.setValueAtTime(tone.outputFrequency, startTime);

    filter.type = "bandpass";
    filter.frequency.setValueAtTime(Math.max(180, tone.outputFrequency * 1.5), startTime);
    filter.Q.setValueAtTime(1.0, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(0.22, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationMs / 1000);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    const voice = { oscillator, filter, gain };
    dialogSpeechState.voices.add(voice);

    oscillator.onended = () => {
      dialogSpeechState.voices.delete(voice);

      try {
        oscillator.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch (_error) {
        // Ignore disconnect errors from already-ended nodes.
      }
    };

    oscillator.start(startTime);
    oscillator.stop(startTime + durationMs / 1000 + 0.02);
  });
}

function stopDialogSpeech() {
  dialogSpeechState.lineToken += 1;

  for (const voice of dialogSpeechState.voices) {
    try {
      voice.oscillator.stop();
    } catch (_error) {
      // Ignore nodes that have already finished.
    }
  }

  dialogSpeechState.voices.clear();
}

function createSynthVoice(scene, frequency, oscillatorType, startDelayMs, durationMs, lineToken) {
  // Kept for compatibility with the existing call shape during the reimplementation.
  playAnimaleseSyllable(scene, { outputFrequency: frequency, isVowel: oscillatorType === "triangle" }, startDelayMs, durationMs, lineToken);
}

function playSynthesizedDialog(scene, dialogLine) {
  const spokenText = (dialogLine?.spokenText || dialogLine?.text || "").trim();
  if (!spokenText) {
    return;
  }

  stopDialogSpeech();

  const basePitch = getDialogBasePitch(dialogLine.speakerName);
  const processedScript = shortenAnimaleseText(spokenText);
  const lineToken = dialogSpeechState.lineToken;
  let delayMs = 0;

  for (let cIndex = 0; cIndex < processedScript.length; cIndex += 1) {
    const character = processedScript.toUpperCase()[cIndex];
    const isPronounceable = character >= "A" && character <= "Z";

    if (isPronounceable) {
      const tone = getAnimaleseCharacterTone(character, basePitch);
      const outputLetterSecs = 0.0375;
      createSynthVoice(scene, tone.outputFrequency, tone.isVowel ? "triangle" : "square", delayMs, outputLetterSecs * 1000, lineToken);
    }

    delayMs += 37.5;
  }
}

function addInventoryItem(itemId, amount = 1) {
  const normalizedItemId = getItemIdByName(itemId) || normalizeItemId(itemId);
  const normalizedAmount = Number(amount);

  if (!normalizedItemId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return false;
  }

  if (!getItemDefinition(normalizedItemId)) {
    return false;
  }

  const currentAmount = inventory.get(normalizedItemId) || 0;
  inventory.set(normalizedItemId, currentAmount + Math.floor(normalizedAmount));
  return true;
}

function listInventoryLines() {
  if (inventory.size === 0) {
    return ["Inventory is empty."];
  }

  const lines = ["Inventory:"];
  Array.from(inventory.entries())
    .sort(([itemIdA], [itemIdB]) => itemIdA.localeCompare(itemIdB))
    .forEach(([itemId, amount]) => {
      const itemDefinition = getItemDefinition(itemId);
      lines.push(`- ${itemDefinition ? itemDefinition.name : itemId}: ${amount}`);
    });

  return lines;
}

function getInventoryItemAboutLines(itemName) {
  const itemDefinition = getItemDefinitionByName(itemName);
  if (!itemDefinition) {
    return ["No item by that name is in your inventory."];
  }

  const inventoryEntry = Array.from(inventory.entries()).find(([itemId]) => {
    const currentDefinition = getItemDefinition(itemId);
    return currentDefinition && currentDefinition.name.toLowerCase() === itemDefinition.name.toLowerCase();
  });

  if (!inventoryEntry) {
    return ["No item by that name is in your inventory."];
  }

  return [
    `${itemDefinition.name}:`,
    itemDefinition.description,
    `You have ${inventoryEntry[1]}.`,
  ];
}

function getInventoryItemNameByExactMatch(itemName) {
  const normalizedName = (itemName || "").trim().toLowerCase();

  if (!normalizedName) {
    return null;
  }

  for (const [itemId] of inventory.entries()) {
    const itemDefinition = getItemDefinition(itemId);
    if (itemDefinition && itemDefinition.name.toLowerCase().startsWith(normalizedName)) {
      return itemDefinition.name;
    }
  }

  return null;
}

function parseDialogMessage(rawMessage) {
  const message = (rawMessage || "").trim();

  const giveMatch = message.match(/^\[Give:\s*([^\]]+)\]$/iu);
  if (giveMatch) {
    return {
      text: "",
      soundFilename: null,
      giveItemName: giveMatch[1].trim(),
      speakerName: null,
      spokenText: "",
    };
  }

  const soundOnlyMatch = message.match(/^\[([^\]]+)\]$/u);
  if (soundOnlyMatch) {
    return {
      text: "",
      soundFilename: soundOnlyMatch[1].trim(),
      giveItemName: null,
      speakerName: null,
      spokenText: "",
    };
  }

  const speakerMatch = message.match(/^([^:\r\n]+):\s*(.+)$/u);
  if (speakerMatch) {
    const speakerName = speakerMatch[1].trim();
    const spokenText = speakerMatch[2].trim();

    return {
      text: message,
      soundFilename: null,
      giveItemName: null,
      speakerName,
      spokenText,
    };
  }

  const match = message.match(/\[([^\]]+)\]/);

  if (!match) {
    return {
      text: message,
      soundFilename: null,
      giveItemName: null,
      speakerName: null,
      spokenText: message,
    };
  }

  const textWithoutSoundTag = message.replace(match[0], "").trim();

  return {
    text: textWithoutSoundTag,
    soundFilename: match[1].trim(),
    giveItemName: null,
    speakerName: null,
    spokenText: textWithoutSoundTag,
  };
}

function parseDialogLines(rawDialogText) {
  return (rawDialogText || "")
    .split(/\r?\n/u)
    .map((line) => parseDialogMessage(line))
    .filter((line) => Boolean(line.text || line.soundFilename || line.giveItemName));
}

function handleDialogReward(scene, itemName, amount = 1) {
  const normalizedAmount = Number(amount);
  const rewardAmount = Number.isFinite(normalizedAmount) && normalizedAmount > 0 ? Math.floor(normalizedAmount) : 1;
  const rewardItemId = getItemIdByName(itemName);

  if (!rewardItemId || !addInventoryItem(rewardItemId, rewardAmount)) {
    return false;
  }

  const rewardDefinition = getItemDefinition(rewardItemId);
  const rewardName = rewardDefinition ? rewardDefinition.name : itemName;
  appendConsoleMessage(`Received ${rewardName} x${rewardAmount}.`);

  return true;
}

function playDialogSpeech(scene, dialogLine) {
  if (!dialogLine) {
    return;
  }

  if (dialogLine.speakerName || dialogLine.spokenText) {
    playSynthesizedDialog(scene, dialogLine);
    return;
  }

  if (dialogLine.soundFilename) {
    playChapterDialogSound(scene, dialogLine.soundFilename);
  }
}

function playChapterDialogLine(scene, dialogLine) {
  if (!dialogLine) {
    return;
  }

  if (dialogLine.text) {
    appendConsoleMessage(dialogLine.text);
  }

  if (dialogLine.giveItemName) {
    handleDialogReward(scene, dialogLine.giveItemName, 1);
  }

  playDialogSpeech(scene, dialogLine);
}

function beginChapterDialog(scene, npc, dialogLines) {
  if (!npc || !Array.isArray(dialogLines) || dialogLines.length === 0) {
    return false;
  }

  activeChapterDialog = {
    npc,
    lines: dialogLines,
    index: 0,
  };

  playChapterDialogLine(scene, dialogLines[0]);
  return true;
}

function advanceChapterDialog(scene) {
  if (!activeChapterDialog) {
    return;
  }

  activeChapterDialog.index += 1;
  if (activeChapterDialog.index >= activeChapterDialog.lines.length) {
    if (Number.isInteger(activeChapterDialog.npc?.chapterAfterDialog)) {
      chapter = activeChapterDialog.npc.chapterAfterDialog;
    }

    activeChapterDialog = null;
    renderConsole();
    return;
  }

  const nextLine = activeChapterDialog.lines[activeChapterDialog.index];
  if (nextLine.text || nextLine.soundFilename) {
    appendConsoleSpacerLine();
  }

  playChapterDialogLine(scene, nextLine);

  if (
    nextLine.giveItemName &&
    !nextLine.text &&
    !nextLine.soundFilename &&
    activeChapterDialog.index === activeChapterDialog.lines.length - 1
  ) {
    if (Number.isInteger(activeChapterDialog.npc?.chapterAfterDialog)) {
      chapter = activeChapterDialog.npc.chapterAfterDialog;
    }

    activeChapterDialog = null;
    renderConsole();
  }
}

function getChapterDialogSoundKey(filename) {
  const normalizedKey = (filename || "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `chapter-dialog-${normalizedKey}`;
}

function playChapterDialogSound(scene, filename) {
  const normalizedFilename = (filename || "").trim();
  if (!normalizedFilename) {
    return;
  }

  const soundKey = getChapterDialogSoundKey(normalizedFilename);

  if (scene.cache.audio.exists(soundKey)) {
    scene.sound.stopByKey(soundKey);
    scene.sound.play(soundKey);
    return;
  }

  if (chapterDialogSoundState.loading.has(soundKey)) {
    return;
  }

  chapterDialogSoundState.loading.add(soundKey);

  scene.load.audio(soundKey, `../assets/sounds/${normalizedFilename}`);
  scene.load.once(`filecomplete-audio-${soundKey}`, () => {
    chapterDialogSoundState.loading.delete(soundKey);
    chapterDialogSoundState.loaded.add(soundKey);
    scene.sound.stopByKey(soundKey);
    scene.sound.play(soundKey);
  });
  scene.load.once("loaderror", (fileObj) => {
    if (fileObj?.key === soundKey) {
      chapterDialogSoundState.loading.delete(soundKey);
    }
  });
  scene.load.start();
}

function getVisibleConsoleLines() {
  const historyLineSlots = consoleVisibleLines - 1;
  const historyEnd = Math.max(0, consoleHistory.length - consoleScrollOffset);
  const historyStart = Math.max(0, historyEnd - historyLineSlots);
  const visibleHistory = consoleHistory.slice(historyStart, historyEnd);
  const paddedHistory = Array(Math.max(0, historyLineSlots - visibleHistory.length)).fill("");
  const inputLine = activeChapterDialog
    ? "Press Space to continue"
    : isConsoleTyping
      ? `> ${consoleInput}`
      : "> (Press Enter to type)";
  return [...paddedHistory, ...visibleHistory, inputLine];
}

function renderConsole() {
  if (!consoleText) {
    return;
  }

  consoleText.setText(getVisibleConsoleLines().join("\n"));
}

function appendConsoleMessage(message) {
  const normalized = (message || "").trim();
  if (!normalized) {
    return;
  }

  normalized.split(/\r?\n/u).forEach((line) => {
    const trimmedLine = line.trim();
    if (trimmedLine) {
      consoleHistory.push(trimmedLine);
    }
  });

  if (consoleHistory.length > consoleMaxHistory) {
    consoleHistory = consoleHistory.slice(consoleHistory.length - consoleMaxHistory);
  }

  consoleScrollOffset = 0;
  renderConsole();
}

function appendConsoleSpacerLine() {
  consoleHistory.push("");

  if (consoleHistory.length > consoleMaxHistory) {
    consoleHistory = consoleHistory.slice(consoleHistory.length - consoleMaxHistory);
  }

  consoleScrollOffset = 0;
  renderConsole();
}

function executeConsoleCommand(rawInput) {
  const input = rawInput.trim();
  if (!input) {
    return;
  }

  appendConsoleMessage(`> ${input}`);

  if (!input.startsWith("/")) {
    appendConsoleMessage('Commands must start with "/". Try /help.');
    return;
  }

  const [command] = input.split(/\s+/u);
  const normalizedCommand = command.toLowerCase();

  if (normalizedCommand === "/help") {
    appendConsoleMessage("Available commands:");
    appendConsoleMessage("/help - Show command list");
    appendConsoleMessage("/clear - Clear console history");
    appendConsoleMessage("/inventory - Show inventory items and quantities");
    appendConsoleMessage("/about itemname - Show an inventory item's description");
    return;
  }

  if (normalizedCommand === "/clear") {
    consoleHistory = [];
    appendConsoleMessage("Console cleared.");
    return;
  }

  if (normalizedCommand === "/inventory") {
    listInventoryLines().forEach((line) => appendConsoleMessage(line));
    return;
  }

  if (normalizedCommand === "/about") {
    const aboutTarget = input.slice(command.length).trim();

    if (!aboutTarget) {
      appendConsoleMessage("Usage: /about itemname");
      return;
    }

    getInventoryItemAboutLines(aboutTarget).forEach((line) => appendConsoleMessage(line));
    return;
  }

  appendConsoleMessage(`Unknown command: ${input}`);
}

function updateConsoleScroll(delta) {
  const maxScroll = Math.max(0, consoleHistory.length - (consoleVisibleLines - 1));
  consoleScrollOffset = Phaser.Math.Clamp(consoleScrollOffset + delta, 0, maxScroll);
  renderConsole();
}

function preload() {
  this.load.image("darktokyotilemap", "../assets/darktokyotilemap.png");
  this.load.image("osaka", "../assets/osaka.png");
  this.load.image("trainstation", "../assets/trainstation.png");
  this.load.xml("map", mapFilePath);
  this.load.text("meet-headmaster-dialog", "../assets/dialog/MeetHeadmaster.txt");
  this.load.text("dialog-pitch", "../assets/sounds/pitch.txt");
  this.load.audio("town-bgm", "../assets/sounds/Lo-Fi Sunday Drive Main.wav");

  // An atlas is a way to pack multiple images together into one texture. I'm using it to load all
  // the player animations (walking left, walking right, etc.) in one image. For more info see:
  //  https://labs.phaser.io/view.html?src=src/animation/texture%20atlas%20animation.js
  // If you don't use an atlas, you can do the same thing with a spritesheet, see:
  //  https://labs.phaser.io/view.html?src=src/animation/single%20sprite%20sheet.js
  this.load.atlas("atlas", "../assets/atlas/atlas.png", "../assets/atlas/atlas.json");
}

function create() {
  this.sound.setVolume(masterVolume);

  const mapXml = this.cache.xml.get("map");
  const isTownMap = mapFilePath.toLowerCase().endsWith("town.tmx");
  dialogPitchConfig = parseDialogPitchConfig(this.cache.text.get("dialog-pitch"));
  stopDialogSpeech();

  if (isTownMap) {
    this.sound.stopByKey("town-bgm");
    this.sound.play("town-bgm", { loop: true, volume: 0.5 });
  }

  const mapNode = mapXml.getElementsByTagName("map")[0];
  const tilesetNodes = Array.from(mapNode.getElementsByTagName("tileset"));
  const layerNodes = Array.from(mapNode.getElementsByTagName("layer"));
  const objectNodes = mapNode.getElementsByTagName("object");
  const meetHeadmasterDialogLines = parseDialogLines(this.cache.text.get("meet-headmaster-dialog"));

  const mapWidth = Number(mapNode.getAttribute("width"));
  const mapHeight = Number(mapNode.getAttribute("height"));
  const tileWidth = Number(mapNode.getAttribute("tilewidth"));
  const tileHeight = Number(mapNode.getAttribute("tileheight"));
  mapTileWidth = tileWidth;
  mapTileHeight = tileHeight;

  const toLayerData = (layerNode) => {
    const dataNode = layerNode.getElementsByTagName("data")[0];
    const rawCsv = dataNode.textContent.replace(/\s+/g, "").split(",");
    const layerData = [];

    for (let y = 0; y < mapHeight; y += 1) {
      const rowStart = y * mapWidth;
      const row = rawCsv
        .slice(rowStart, rowStart + mapWidth)
        .map(Number)
        .map((tile) => (tile === 0 ? -1 : tile));
      layerData.push(row);
    }

    return layerData;
  };

  const tilesetConfigs = tilesetNodes
    .map((tilesetNode) => {
      const name =
        tilesetNode.getAttribute("name") ||
        tilesetNode
          .getAttribute("source")
          ?.split("/")
          .pop()
          .replace(/\.tsx$/i, "");

      if (!name) {
        return null;
      }

      return {
        name,
        firstGid: Number(tilesetNode.getAttribute("firstgid") || 1),
      };
    })
    .filter(Boolean);
  let worldLayer = null;
  let collisionLayer = null;
  let collisionLayerDepth = null;
  let topLayerDepth = -1;

  const getNodeProperty = (node, propertyName) => {
    const propertiesNode = node.getElementsByTagName("properties")[0];
    if (!propertiesNode) {
      return null;
    }

    const propertyNodes = Array.from(propertiesNode.getElementsByTagName("property"));
    const propertyNode = propertyNodes.find(
      (prop) => prop.getAttribute("name")?.toLowerCase() === propertyName.toLowerCase(),
    );

    if (!propertyNode) {
      return null;
    }

    return propertyNode.getAttribute("value") || propertyNode.textContent || null;
  };

  layerNodes.forEach((layerNode, index) => {
    const layerMap = this.make.tilemap({
      data: toLayerData(layerNode),
      tileWidth,
      tileHeight,
    });
    const layerTilesets = tilesetConfigs
      .map((tilesetConfig) =>
        layerMap.addTilesetImage(
          tilesetConfig.name,
          tilesetConfig.name,
          tileWidth,
          tileHeight,
          0,
          0,
          tilesetConfig.firstGid,
        ),
      )
      .filter(Boolean);

    const layer = layerMap.createLayer(0, layerTilesets, 0, 0);
    layer.setVisible(true);
    layer.setDepth(index);
    topLayerDepth = Math.max(topLayerDepth, index);

    if (!worldLayer) {
      worldLayer = layer;
    }

    if (layerNode.getAttribute("name")?.toLowerCase() === "collision") {
      collisionLayer = layer;
      collisionLayerDepth = index;
      collisionLayer.setCollisionByExclusion([-1]);
    }
  });

  let spawnPoint = { x: tileWidth, y: tileHeight };
  let headmasterNpc = null;
  interactableNpcs = [];
  consoleHistory = [];
  consoleInput = "";
  isConsoleTyping = false;
  consoleScrollOffset = 0;

  for (let i = 0; i < objectNodes.length; i += 1) {
    const obj = objectNodes[i];
    const name = obj.getAttribute("name") || "";
    const type = obj.getAttribute("type") || "";
    const normalizedName = name.toLowerCase();
    const normalizedType = type.toLowerCase();
    const isStartObject = [name, type].some(
      (value) => value.toLowerCase() === "playerspawn" || value.toLowerCase() === "start",
    );

    if (isStartObject) {
      spawnPoint = {
        x: Number(obj.getAttribute("x")),
        y: Number(obj.getAttribute("y")),
      };
      continue;
    }

    const isHeadmasterSpawnObject =
      normalizedName === "headmaster" ||
      normalizedType === "headmaster" ||
      normalizedName === "wizardspawn" ||
      normalizedType === "wizardspawn";

    if (isHeadmasterSpawnObject) {
      const parsedHeadmasterDialog = parseDialogMessage(
        getNodeProperty(obj, "dialog") ||
          getNodeProperty(obj, "string") ||
          getNodeProperty(obj, "message") ||
          getNodeProperty(obj, "text"),
      );

      headmasterNpc = {
        x: Number(obj.getAttribute("x")),
        y: Number(obj.getAttribute("y")),
        message: parsedHeadmasterDialog.text,
        soundFilename: parsedHeadmasterDialog.soundFilename,
        speakerName: parsedHeadmasterDialog.speakerName,
        spokenText: parsedHeadmasterDialog.spokenText,
        chapterDialogLines: meetHeadmasterDialogLines,
        chapterForDialog: 0,
        chapterAfterDialog: 1,
      };
      continue;
    }

    const message =
      getNodeProperty(obj, "dialog") ||
      getNodeProperty(obj, "string") ||
      getNodeProperty(obj, "message") ||
      getNodeProperty(obj, "text");

    const parsedDialog = parseDialogMessage(message);

    const hasDialogProperty = Boolean(message);
    const isPointObject = obj.getElementsByTagName("point").length > 0;
    if (!hasDialogProperty || !isPointObject) {
      continue;
    }

    const x = Number(obj.getAttribute("x")) || 0;
    const y = Number(obj.getAttribute("y")) || 0;

    interactableNpcs.push({
      x,
      y,
      message: parsedDialog.text,
      soundFilename: parsedDialog.soundFilename,
      speakerName: parsedDialog.speakerName,
      spokenText: parsedDialog.spokenText,
    });
  }

  // Create a sprite with physics enabled via the physics system. The image used for the sprite has
  // a bit of whitespace, so I'm using setSize & setOffset to control the size of the player's body.
  player = this.physics.add
    .sprite(spawnPoint.x, spawnPoint.y, "atlas", "misa-front")
    .setSize(30, 40)
    .setOffset(0, 24);

  if (collisionLayerDepth !== null) {
    player.setDepth(collisionLayerDepth - 0.5);
  } else if (topLayerDepth >= 0) {
    player.setDepth(topLayerDepth + 1);
  }

  if (headmasterNpc) {
    const headmaster = this.add.sprite(
      headmasterNpc.x,
      headmasterNpc.y,
      "atlas",
      "misa-front",
    );

    headmaster.setDepth(player.depth);

    interactableNpcs.push({
      x: headmasterNpc.x,
      y: headmasterNpc.y,
      message: headmasterNpc.message,
      soundFilename: headmasterNpc.soundFilename,
      speakerName: headmasterNpc.speakerName,
      spokenText: headmasterNpc.spokenText,
      chapterDialogLines: headmasterNpc.chapterDialogLines,
      chapterForDialog: headmasterNpc.chapterForDialog,
      chapterAfterDialog: headmasterNpc.chapterAfterDialog,
      sprite: headmaster,
    });
  }

  // Watch the player and collision layer for collisions, for the duration of the scene:
  if (collisionLayer) {
    this.physics.add.collider(player, collisionLayer);
  }

  // Create the player's walking animations from the texture atlas. These are stored in the global
  // animation manager so any sprite can access them.
  const anims = this.anims;
  anims.create({
    key: "misa-left-walk",
    frames: anims.generateFrameNames("atlas", {
      prefix: "misa-left-walk.",
      start: 0,
      end: 3,
      zeroPad: 3,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: "misa-right-walk",
    frames: anims.generateFrameNames("atlas", {
      prefix: "misa-right-walk.",
      start: 0,
      end: 3,
      zeroPad: 3,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: "misa-front-walk",
    frames: anims.generateFrameNames("atlas", {
      prefix: "misa-front-walk.",
      start: 0,
      end: 3,
      zeroPad: 3,
    }),
    frameRate: 10,
    repeat: -1,
  });
  anims.create({
    key: "misa-back-walk",
    frames: anims.generateFrameNames("atlas", {
      prefix: "misa-back-walk.",
      start: 0,
      end: 3,
      zeroPad: 3,
    }),
    frameRate: 10,
    repeat: -1,
  });

  const camera = this.cameras.main;
  camera.startFollow(player);
  camera.setBounds(0, 0, mapWidth * tileWidth, mapHeight * tileHeight);

  cursors = this.input.keyboard.createCursorKeys();
  interactKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F);
  spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);

  const consoleHeight = 98;
  const consoleWidth = this.scale.width - 24;
  const consoleX = 12;
  const consoleY = this.scale.height - consoleHeight - 12;

  this.add
    .rectangle(consoleX, consoleY, consoleWidth, consoleHeight, 0x0f0f0f, 0.85)
    .setOrigin(0, 0)
    .setStrokeStyle(2, 0x8dd3ff, 0.9)
    .setScrollFactor(0)
    .setDepth(30);

  consoleText = this.add
    .text(consoleX + 10, consoleY + 8, "", {
      font: "16px monospace",
      fill: "#e7f6ff",
      lineSpacing: 6,
      wordWrap: { width: consoleWidth - 20, useAdvancedWrap: true },
    })
    .setScrollFactor(0)
    .setDepth(31);

  appendConsoleMessage(defaultDialogMessage);

  this.input.on("wheel", (pointer, gameObjects, deltaX, deltaY) => {
    if (deltaY < 0) {
      updateConsoleScroll(1);
    } else if (deltaY > 0) {
      updateConsoleScroll(-1);
    }
  });

  if (commandKeyListener) {
    this.input.keyboard.off("keydown", commandKeyListener);
  }

  commandKeyListener = (event) => {
    if (!isConsoleTyping && event.key === "Enter") {
      isConsoleTyping = true;
      renderConsole();
      event.preventDefault();
      return;
    }

    if (event.key === "PageUp") {
      updateConsoleScroll(1);
      event.preventDefault();
      return;
    }

    if (event.key === "PageDown") {
      updateConsoleScroll(-1);
      event.preventDefault();
      return;
    }

    if (event.key === "Escape") {
      consoleInput = "";
      isConsoleTyping = false;
      renderConsole();
      return;
    }

    if (event.key === "Tab") {
      if (isConsoleTyping && consoleInput.toLowerCase().startsWith("/about ")) {
        const aboutTarget = consoleInput.slice("/about".length).trim();
        const completedItemName = getInventoryItemNameByExactMatch(aboutTarget);

        if (completedItemName) {
          consoleInput = `/about ${completedItemName}`;
          renderConsole();
        }
      }

      event.preventDefault();
      return;
    }

    if (event.key === "Enter") {
      if (!isConsoleTyping) {
        return;
      }

      if (!consoleInput.trim()) {
        isConsoleTyping = false;
        renderConsole();
        return;
      }

      executeConsoleCommand(consoleInput);
      consoleInput = "";
      isConsoleTyping = false;
      renderConsole();
      event.preventDefault();
      return;
    }

    if (!isConsoleTyping) {
      return;
    }

    if (event.key === "Backspace") {
      if (!consoleInput) {
        return;
      }

      consoleInput = consoleInput.slice(0, -1);
      renderConsole();
      event.preventDefault();
      return;
    }

    const isTextKey = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (!isTextKey) {
      return;
    }

    consoleInput += event.key;
    renderConsole();
    event.preventDefault();
  };

  this.input.keyboard.on("keydown", commandKeyListener);

  // Debug graphics
  this.input.keyboard.on("keydown-D", () => {
    if (showDebug || isConsoleTyping || consoleInput.startsWith("/")) {
      return;
    }

    showDebug = true;

    // Turn on physics debugging to show player's hitbox
    this.physics.world.createDebugGraphic();

    // Create worldLayer collision graphic above the player, but below the help text
    const graphics = this.add.graphics().setAlpha(0.75).setDepth(20);
    (collisionLayer || worldLayer).renderDebug(graphics, {
      tileColor: null, // Color of non-colliding tiles
      collidingTileColor: new Phaser.Display.Color(243, 134, 48, 255), // Color of colliding tiles
      faceColor: new Phaser.Display.Color(40, 39, 37, 255), // Color of colliding face edges
    });
  });
}

function update(time, delta) {
  if (isConsoleTyping) {
    player.body.setVelocity(0);
    player.anims.stop();
    return;
  }

  if (activeChapterDialog) {
    player.body.setVelocity(0);
    player.anims.stop();

    if (Phaser.Input.Keyboard.JustDown(spaceKey)) {
      advanceChapterDialog(this);
    }

    return;
  }

  const speed = 175;
  const prevVelocity = player.body.velocity.clone();

  // Stop any previous movement from the last frame
  player.body.setVelocity(0);

  // Horizontal movement
  if (cursors.left.isDown) {
    player.body.setVelocityX(-speed);
  } else if (cursors.right.isDown) {
    player.body.setVelocityX(speed);
  }

  // Vertical movement
  if (cursors.up.isDown) {
    player.body.setVelocityY(-speed);
  } else if (cursors.down.isDown) {
    player.body.setVelocityY(speed);
  }

  // Normalize and scale the velocity so that player can't move faster along a diagonal
  player.body.velocity.normalize().scale(speed);

  // Update the animation last and give left/right animations precedence over up/down animations
  if (cursors.left.isDown) {
    player.anims.play("misa-left-walk", true);
  } else if (cursors.right.isDown) {
    player.anims.play("misa-right-walk", true);
  } else if (cursors.up.isDown) {
    player.anims.play("misa-back-walk", true);
  } else if (cursors.down.isDown) {
    player.anims.play("misa-front-walk", true);
  } else {
    player.anims.stop();

    // If we were moving, pick and idle frame to use
    if (prevVelocity.x < 0) player.setTexture("atlas", "misa-left");
    else if (prevVelocity.x > 0) player.setTexture("atlas", "misa-right");
    else if (prevVelocity.y < 0) player.setTexture("atlas", "misa-back");
    else if (prevVelocity.y > 0) player.setTexture("atlas", "misa-front");
  }

  if (consoleText) {
    const playerX = player.body ? player.body.center.x : player.x;
    const playerY = player.body ? player.body.center.y : player.y;
    const nearbyNpc = interactableNpcs.find(
      (npc) =>
        Math.abs(playerX - npc.x) <= mapTileWidth &&
        Math.abs(playerY - npc.y) <= mapTileHeight,
    );

    if (nearbyNpc && Phaser.Input.Keyboard.JustDown(interactKey)) {
      const shouldUseChapterDialog =
        Array.isArray(nearbyNpc.chapterDialogLines) &&
        nearbyNpc.chapterDialogLines.length > 0 &&
        chapter === nearbyNpc.chapterForDialog;

      if (shouldUseChapterDialog) {
        beginChapterDialog(this, nearbyNpc, nearbyNpc.chapterDialogLines);
      } else {
        appendConsoleMessage(nearbyNpc.message || "...");
        playDialogSpeech(this, nearbyNpc);
      }
    }
  }
}