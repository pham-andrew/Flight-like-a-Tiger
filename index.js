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
let player;
let showDebug = false;
let dialogBox;
let dialogPoints = [];
let defaultDialogMessage = 'Arrow keys to move\nPress "D" to show hitboxes';
let mapTileWidth = 32;
let mapTileHeight = 32;

function preload() {
  this.load.image("darktokyotilemap", "../assets/darktokyotilemap.png");
  this.load.image("trainstation", "../assets/trainstation.png");
  this.load.xml("map", "../assets/tilemapfile2.tmx");

  // An atlas is a way to pack multiple images together into one texture. I'm using it to load all
  // the player animations (walking left, walking right, etc.) in one image. For more info see:
  //  https://labs.phaser.io/view.html?src=src/animation/texture%20atlas%20animation.js
  // If you don't use an atlas, you can do the same thing with a spritesheet, see:
  //  https://labs.phaser.io/view.html?src=src/animation/single%20sprite%20sheet.js
  this.load.atlas("atlas", "../assets/atlas/atlas.png", "../assets/atlas/atlas.json");
}

function create() {
  const mapXml = this.cache.xml.get("map");
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
  let middleLayerDepth = null;

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

    if (!worldLayer) {
      worldLayer = layer;
    }

    if (layerNode.getAttribute("name")?.toLowerCase() === "collision") {
      collisionLayer = layer;
      collisionLayer.setCollisionByExclusion([-1]);
    }

    if (layerNode.getAttribute("name")?.toLowerCase() === "middle") {
      middleLayerDepth = index;
    }
  });

  let spawnPoint = { x: tileWidth, y: tileHeight };
  dialogPoints = [];

  for (let i = 0; i < objectNodes.length; i += 1) {
    const obj = objectNodes[i];
    const name = obj.getAttribute("name") || "";
    if (name === "PlayerSpawn") {
      spawnPoint = {
        x: Number(obj.getAttribute("x")),
        y: Number(obj.getAttribute("y")),
      };
      continue;
    }

    const message =
      getNodeProperty(obj, "dialog") ||
      getNodeProperty(obj, "string") ||
      getNodeProperty(obj, "message") ||
      getNodeProperty(obj, "text");

    const hasDialogProperty = Boolean(message);
    const isPointObject = obj.getElementsByTagName("point").length > 0;
    if (!hasDialogProperty || !isPointObject) {
      continue;
    }

    const x = Number(obj.getAttribute("x")) || 0;
    const y = Number(obj.getAttribute("y")) || 0;

    dialogPoints.push({
      x,
      y,
      message,
    });
  }

  // Create a sprite with physics enabled via the physics system. The image used for the sprite has
  // a bit of whitespace, so I'm using setSize & setOffset to control the size of the player's body.
  player = this.physics.add
    .sprite(spawnPoint.x, spawnPoint.y, "atlas", "misa-front")
    .setSize(30, 40)
    .setOffset(0, 24);

  if (middleLayerDepth !== null) {
    player.setDepth(middleLayerDepth + 0.5);
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

  // Dialog box text that has a fixed position on the screen
  dialogBox = this.add
    .text(16, 16, defaultDialogMessage, {
      font: "18px monospace",
      fill: "#000000",
      padding: { x: 20, y: 10 },
      backgroundColor: "#ffffff",
    })
    .setScrollFactor(0)
    .setDepth(30);

  // Debug graphics
  this.input.keyboard.once("keydown-D", (event) => {
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

  if (dialogBox) {
    const playerX = player.body ? player.body.center.x : player.x;
    const playerY = player.body ? player.body.center.y : player.y;
    const activeDialogPoint = dialogPoints.find(
      (point) =>
        Math.abs(playerX - point.x) <= mapTileWidth * 0.5 &&
        Math.abs(playerY - point.y) <= mapTileHeight * 0.5,
    );

    const nextMessage =
      (activeDialogPoint && activeDialogPoint.message) || defaultDialogMessage;
    if (dialogBox.text !== nextMessage) {
      dialogBox.setText(nextMessage);
    }
  }
}