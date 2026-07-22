const uWS = require("uWebSockets.js");
const { IncomingPacket, OutgoingPacket, PacketHeader } = require("./packet.js");
const { remoteAddressToString } = require("./utils.js");
const fetch = require("node-fetch");
const Player = require("./player.js");
/*const RankedGame = require("./rankedgame.js");
RankedGame.loadActivesFromDB();*/

let server;

if (process.env.PRODUCTION) {
  server = new uWS.SSLApp({
    key_file_name: "/etc/letsencrypt/live/nomnom.gg/privkey.pem",
    cert_file_name: "/etc/letsencrypt/live/nomnom.gg/cert.pem",
  });
} else {
  server = uWS.App();
}


// Client WebSockets
server.ws("/*", {
  idleTimeout: 32,
  maxBackpressure: 1024,
  maxPayloadLength: 512,
  compression: uWS.DEDICATED_COMPRESSOR_3KB,

  upgrade: (res, req, context) => {
    const query = req.getQuery();
    const params = Object.fromEntries(new URLSearchParams(query));
    console.log("WebSocket upgrade requested", params);

    res.onAborted(() => {
      console.log("WebSocket upgrade aborted");
    });

    res.upgrade(
      {  }, // Mutable object that will be available in ws
      req.getHeader("sec-websocket-key"),
      req.getHeader("sec-websocket-protocol"),
      req.getHeader("sec-websocket-extensions"),
      context
    );
  },

  open: async (ws) => {

    ws.ipAddr = remoteAddressToString(ws.getRemoteAddress());
    console.log("()=> ", ws.ipAddr);

    global.main.CCU++;

    ws.player = new Player(ws);
  },

  message: async (ws, message, isBinary) => {
    if(!ws.player)
    {
      return;
    }

    if (!isBinary) {
      try{ws.close();}catch(err){}
      return;
    }

    const inPkt = new IncomingPacket(message);
    const header = inPkt.ReadByte();
    switch (header) {
      case PacketHeader.Common.PONG:
        {
          ws.player.onPing();
        }
        break;
      case PacketHeader.Client.LOCAL_SNAPSHOT:
        {
          const pos = [
            inPkt.ReadFloat(),
            inPkt.ReadFloat(),
            inPkt.ReadFloat()
          ];

          const eulers = [
            inPkt.ReadFloat(),
            inPkt.ReadFloat(),
            inPkt.ReadFloat()
          ];
          const bladeRotSpeed = inPkt.ReadFloat();

          ws.player.onLocalSnapshot(pos, eulers, bladeRotSpeed);
        }
        break;
      default:
        console.log("Unhandled network packet header:", header);
        break;
    }
  },

  close: (ws) => {
    console.log("<=() ", ws.ipAddr);

    global.main.CCU--;

    if (ws.player) ws.player.onDisconnect();
  },
});

function listen() {
  server.listen(global.main.PORT, (listenToken) => {
    if (listenToken) console.log("Server listening on ", global.main.PORT);
    else console.log("Failed to listen on port", global.main.PORT);
  });
}
listen();

/*function broadcast(pkt, exceptThoseInRanked = false){
  for (let i = 0; i < Player.LIST.length; i++) {
    const player = Player.LIST[i];
    if (!player || player.isBot) continue;
    if(exceptThoseInRanked && player.currentRankedGame) continue;

    try {
      player.ws.send(pkt.buffer, true);
    } catch (err) {}
  }
}*/

module.exports = {
  player: Player
};