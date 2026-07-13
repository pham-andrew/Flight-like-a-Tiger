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

function preload() {
  this.load.image("tiles", "../assets/tilemaps/Free_Version/Tilemap/Tilemap.png");
  this.load.xml("map", "../assets/tilemaps/Free_Version/test.tmx");

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
  const layerNodes = Array.from(mapNode.getElementsByTagName("layer"));
  const objectNodes = mapNode.getElementsByTagName("object");

  const mapWidth = Number(mapNode.getAttribute("width"));
  const mapHeight = Number(mapNode.getAttribute("height"));
  const tileWidth = Number(mapNode.getAttribute("tilewidth"));
  const tileHeight = Number(mapNode.getAttribute("tileheight"));

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

  const walkableLayerNode =
    layerNodes.find((layer) => layer.getAttribute("name")?.toLowerCase() === "walkable") ||
    layerNodes[0];
  const collisionLayerNode = layerNodes.find(
    (layer) => layer.getAttribute("name")?.toLowerCase() === "collision",
  );

  const walkableLayerData = toLayerData(walkableLayerNode);

  const map = this.make.tilemap({
    data: walkableLayerData,
    tileWidth,
    tileHeight,
  });

  const tileset = map.addTilesetImage("test", "tiles", tileWidth, tileHeight, 0, 0, 1);
  const worldLayer = map.createLayer(0, tileset, 0, 0);
  let collisionLayer = null;

  if (collisionLayerNode) {
    const collisionMap = this.make.tilemap({
      data: toLayerData(collisionLayerNode),
      tileWidth,
      tileHeight,
    });
    const collisionTileset = collisionMap.addTilesetImage(
      "test",
      "tiles",
      tileWidth,
      tileHeight,
      0,
      0,
      1,
    );

    collisionLayer = collisionMap.createLayer(0, collisionTileset, 0, 0);
    collisionLayer.setVisible(true);
    collisionLayer.setCollisionByExclusion([-1]);
  }

  let spawnPoint = { x: tileWidth, y: tileHeight };
  for (let i = 0; i < objectNodes.length; i += 1) {
    const obj = objectNodes[i];
    if (obj.getAttribute("name") === "PlayerSpawn") {
      spawnPoint = {
        x: Number(obj.getAttribute("x")),
        y: Number(obj.getAttribute("y")),
      };
      break;
    }
  }

  // Create a sprite with physics enabled via the physics system. The image used for the sprite has
  // a bit of whitespace, so I'm using setSize & setOffset to control the size of the player's body.
  player = this.physics.add
    .sprite(spawnPoint.x, spawnPoint.y, "atlas", "misa-front")
    .setSize(30, 40)
    .setOffset(0, 24);

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
  camera.setBounds(0, 0, map.widthInPixels, map.heightInPixels);

  cursors = this.input.keyboard.createCursorKeys();

  // Help text that has a "fixed" position on the screen
  this.add
    .text(16, 16, 'Arrow keys to move\nPress "D" to show hitboxes', {
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
}