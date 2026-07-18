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
let player;
let showDebug = false;
let consoleText;
let interactableNpcs = [];
let defaultDialogMessage = 'Arrow keys to move\nPress "F" to interact\nPress "D" to show hitboxes';
let consoleHistory = [];
let consoleScrollOffset = 0;
let consoleInput = "";
let isConsoleTyping = false;
let commandKeyListener;
const consoleVisibleLines = 3;
const consoleMaxHistory = 250;
let mapTileWidth = 32;
let mapTileHeight = 32;
const mapFilePath = "../assets/town.tmx";
const masterVolume = 0.5;
const dialogSoundState = {
  loaded: new Set(),
  loading: new Set(),
};

function parseDialogMessage(rawMessage) {
  const message = (rawMessage || "").trim();
  const match = message.match(/^\[([^\]]+)\]\s*(.*)$/s);

  if (!match) {
    return {
      text: message,
      soundFilename: null,
    };
  }

  return {
    text: (match[2] || "").trim(),
    soundFilename: match[1].trim(),
  };
}

function getAnimaleseSoundKey(filename) {
  return `animalese-${filename.replace(/\.[^.]+$/u, "").toLowerCase()}`;
}

function normalizeDialogSoundFilename(filename) {
  const trimmed = (filename || "").trim();
  if (!trimmed) {
    return null;
  }

  return /\.[a-z0-9]+$/iu.test(trimmed) ? trimmed : `${trimmed}.wav`;
}

function playDialogSound(scene, filename) {
  const normalizedFilename = normalizeDialogSoundFilename(filename);
  if (!normalizedFilename) {
    return;
  }

  const soundKey = getAnimaleseSoundKey(normalizedFilename);

  if (scene.cache.audio.exists(soundKey)) {
    scene.sound.stopByKey(soundKey);
    scene.sound.play(soundKey);
    return;
  }

  if (dialogSoundState.loading.has(soundKey)) {
    return;
  }

  dialogSoundState.loading.add(soundKey);

  scene.load.audio(soundKey, `../assets/sounds/animalese/${normalizedFilename}`);
  scene.load.once(`filecomplete-audio-${soundKey}`, () => {
    dialogSoundState.loading.delete(soundKey);
    dialogSoundState.loaded.add(soundKey);
    scene.sound.stopByKey(soundKey);
    scene.sound.play(soundKey);
  });
  scene.load.once(`loaderror`, (fileObj) => {
    if (fileObj?.key === soundKey) {
      dialogSoundState.loading.delete(soundKey);
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
  const inputLine = isConsoleTyping
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

  const normalizedCommand = input.toLowerCase();

  if (normalizedCommand === "/help") {
    appendConsoleMessage("Available commands:");
    appendConsoleMessage("/help - Show command list");
    appendConsoleMessage("/clear - Clear console history");
    return;
  }

  if (normalizedCommand === "/clear") {
    consoleHistory = [];
    appendConsoleMessage("Console cleared.");
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

  if (isTownMap) {
    this.sound.stopByKey("town-bgm");
    this.sound.play("town-bgm", { loop: true, volume: 0.5 });
  }

  const mapNode = mapXml.getElementsByTagName("map")[0];
  const tilesetNodes = Array.from(mapNode.getElementsByTagName("tileset"));
  const layerNodes = Array.from(mapNode.getElementsByTagName("layer"));
  const objectNodes = mapNode.getElementsByTagName("object");

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
  let wizardNpc = null;
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

    const isWizardSpawnObject =
      normalizedName === "wizardspawn" || normalizedType === "wizardspawn";

    if (isWizardSpawnObject) {
      const parsedWizardDialog = parseDialogMessage(
        getNodeProperty(obj, "dialog") ||
          getNodeProperty(obj, "string") ||
          getNodeProperty(obj, "message") ||
          getNodeProperty(obj, "text"),
      );

      wizardNpc = {
        x: Number(obj.getAttribute("x")),
        y: Number(obj.getAttribute("y")),
        message: parsedWizardDialog.text,
        soundFilename: parsedWizardDialog.soundFilename,
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

  if (wizardNpc) {
    const wizard = this.add.sprite(
      wizardNpc.x,
      wizardNpc.y,
      "atlas",
      "misa-front",
    );

    wizard.setDepth(player.depth);

    interactableNpcs.push({
      x: wizardNpc.x,
      y: wizardNpc.y,
      message: wizardNpc.message,
      soundFilename: wizardNpc.soundFilename,
      sprite: wizard,
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
    if (deltaY > 0) {
      updateConsoleScroll(1);
    } else if (deltaY < 0) {
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
    if (showDebug || consoleInput.startsWith("/")) {
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
      appendConsoleMessage(nearbyNpc.message || "...");
      playDialogSound(this, nearbyNpc.soundFilename);
    }
  }
}