const express = require('express')
const socketio = require('socket.io')
const http = require('http')
const path = require('path')

// TODO LIST:
// * Timer

const ships = [
  {name: 'aircraft_carrier1', tiles: 5, destCount: 4},
  {name: 'aircraft_carrier2', tiles: 5, destCount: 4},
  {name: 'cruiser', tiles: 4, destCount: 3},
  {name: 'ferry', tiles: 3, destCount: 2},
  {name: 'ferry2', tiles: 3, destCount: 2},
  {name: 'fishing_ship', tiles: 3, destCount: 2},
  {name: 'destroyer', tiles: 2, destCount: 1},
  {name: 'submarine1', tiles: 1, destCount: 1}
]

let app = express()
let server = http.createServer(app)
let io = socketio(server)

app.enable('trust proxy')
app.disable('x-powered-by')

app.use('/', express.static(path.join(__dirname, '/client/')))

function playerNameValidation (name) {
  if (/^([A-Z0-9_\-@]{3,20})$/i.test(name)) {
    return true
  }
  return false
}

let clients = {}
let games = {}

let totalGames = 0

// Generate a random int betweem two ints
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// Generate random string of characters
function nuid(len) {
  let buf = [],
    chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    charlen = chars.length

  for (let i = 0; i < len; ++i) {
    buf.push(chars[getRandomInt(0, charlen - 1)])
  }

  return buf.join('')
}

function clientsBySocketID (id) {
  let result = null

  for (let uid in clients) {
    let client = clients[uid]
    if (client.sockID === id) {
      result = uid
    }
  }

  return result
}

function determineOpponent (myIndex) {
  let opponent = 'player2'
  
  if (myIndex === 'player2') {
    opponent = 'player1'
  }

  return opponent
}

function killGamesClientIsIn (uid) {
  for (let gameId in games) {
    let game = games[gameId]
    if (game.player1 && game.player1.uid === uid) {
      if (!game.isWaiting && game.player2) {
        clients[game.player2.uid].socket.emit('game_end', {win: true, result: 0})
      }
    } else if (game.player2 && game.player2.uid === uid) {
      if (clients[game.player1.uid]) {
        clients[game.player1.uid].socket.emit('game_end', {win: true, result: 0})
      }
    } else {
      continue
    }
    delete games[gameId]
    console.log(gameId + ' was ended abruptly on ' + uid + '\'s demand.')
  }
}

function createNewGame (uid) {
  let client = clients[uid]
  let gameId = nuid(16)

  client.socket.emit('game_new_done', {gameId: gameId})

  console.log(client.name + ' has started a new game. ID: ' + gameId)

  games[gameId] = {
    player1: {
      uid: uid,
      ships: [],
      strikes: [],
      placed: false,
      destructions: 0
    },
    player2: null,
    isWaiting: true,
    turn: 1,
    created: new Date(),
    started: null
  }
}

function joinGame (uid, gameId) {
  let me = clients[uid]

  if (!games[gameId]) {
    return me.socket.emit('game_error', {message: 'That game has ended!'})
  }

  if (games[gameId].player2 != null) {
    return me.socket.emit('game_error', {message: 'That game has already started!'})
  }

  if (!clients[games[gameId].player1.uid]) {
    return me.socket.emit('game_error', {message: 'That game has ended!'})
  }

  games[gameId].player2 = {
    uid: uid,
    ships: [],
    strikes: [],
    placed: false,
    destructions: 0
  }

  games[gameId].isWaiting = false
  games[gameId].started = new Date()

  let opponent = clients[games[gameId].player1.uid]

  if (!opponent) {
    return me.socket.emit('game_error', {message: 'Your opponent abruptly dissappeared, what?'})
  }

  opponent.socket.emit('game_start', {gameId: gameId, opponentId: uid, opponentName: me.name})
  me.socket.emit('game_start', {gameId: gameId, opponentId: opponent.uid, opponentName: opponent.name})

  totalGames += 1
}

function endGame (gameId, victoryId, loserId) {
  if (clients[victoryId]) {
    clients[victoryId].socket.emit('game_end', {win: true, result: 1})
  }

  if (clients[loserId]) {
    clients[loserId].socket.emit('game_end', {win: false, result: 1})
  }

  delete games[gameId]
  console.log(gameId + ' ended with ' + victoryId + '\'s victory.')
}

function waitingGamesList (uid) {
  let result = []
  let cap = 0

  let gamesInSession = 0
  for (let i in games) {
    let game = games[i]
    if (!game.isWaiting) {
      gamesInSession += 1
    }
  }

  for (let gameId in games) {
    if (cap >= 20) break

    let game = games[gameId]

    if (game.isWaiting) {
      let userName = clients[game.player1.uid].name
      if (uid && game.player1.uid === uid) continue

      result.push({
        gameId: gameId,
        name: userName,
        started: game.started
      })

      cap += 1
    }
  }

  return {
    sessions: gamesInSession,
    totalGames: totalGames,
    list: result
  }
}

function determinePlayerById (gameId, uid) {
  let game = games[gameId]

  if (!game) return null

  if (game.player1 && game.player1.uid === uid) {
    return 'player1'
  } else if (game.player2 && game.player2.uid === uid) {
    return 'player2'
  }

  return null
}

function getShipByName (name) {
  let ship = null
  for (let i in ships) {
    if (ships[i].name === name) {
      ship = ships[i]
    }
  }
  return ship
}

function integrityCheck (shipDataProvided) {
  if (!shipDataProvided.name || shipDataProvided.sunken == null || !shipDataProvided.cells) {
    return false
  }

  let shipActual = getShipByName(shipDataProvided.name)

  if (shipActual === null) {
    return false
  }

  if (shipDataProvided.cells.length !== shipActual.tiles) {
    return false
  }

  return true
}

function getDestroyedTiles (ship) {
  let count = 0
  for (let i in ship.cells) {
    let cell = ship.cells[i]
    if (cell.destroyed === true) {
      count += 1
    }
  }
  return count
}

function markAllTilesDestroyed (ship, myStrikes) {
  for (let i in ship.cells) {
    let cell = ship.cells[i]
    cell.destroyed = true
    myStrikes.push({x: cell.x, y: cell.y, destroy: true})
  }
  ship.sunken = true
}

function checkForExistingStrike (myStrikes, x, y) {
  let found = false
  for (let i in myStrikes) {
    let cell = myStrikes[i]
    if (cell.x === x && cell.y === y) {
      found = true
    }
  }
  return found
}

function attemptToBombTile (playerIndex, opponent, game, x, y) {
  let me = game[playerIndex]
  let opponentObj = game[opponent]

  let tileMatch = null
  let shipMatch = null

  for (let i in opponentObj.ships) {
    let ship = opponentObj.ships[i]
    for (let j in ship.cells) {
      let cell = ship.cells[j]
      if (cell.x === x && cell.y === y) {
        tileMatch = cell
        shipMatch = ship
      }
    }
  }

  if (!tileMatch) {
    if (checkForExistingStrike(me.strikes, x, y)) {
      return {event: 5, ship: null}
    }

    me.strikes.push({x: x, y: y, destroy: false})
    return {event: 2, ship: null}
  }

  if (tileMatch.destroyed === true) {
    return {event: 5, ship: shipMatch}
  }

  tileMatch.destroyed = true
  me.strikes.push({x: x, y: y, destroy: true})

  let shipActual = getShipByName(shipMatch.name)
  let destroyedTileCount = getDestroyedTiles(shipMatch)

  if (destroyedTileCount >= shipActual.destCount) {
    markAllTilesDestroyed(shipMatch, me.strikes)
    opponentObj.destructions += 1

    if (opponentObj.destructions === ships.length) {
      return {event: 6, ship: shipMatch}
    }

    return {event: 1, ship: shipMatch}
  }

  return {event: 0, ship: shipMatch}
}

io.on('connection', (socket) => {
  socket.on('session_create', (data) => {
    if (!data.name) {
      return socket.emit('login_status', {success: false, message: 'Invalid name.'})
    }

    if (!playerNameValidation(data.name)) {
      return socket.emit('login_status', {success: false, message: 'Invalid name.'})
    }

    let playerUid = nuid(32)

    socket.emit('login_status', {success: true, uid: playerUid, name: data.name})
    socket.emit('game_settings', {ships: ships})
    clients[playerUid] = {
      socket: socket,
      name: data.name,
      sockID: socket.conn.id
    }

    console.log('New player: "' + data.name + '" with uid ' + playerUid)
  })

  socket.on('poll_games', () => {
    let client = clientsBySocketID(socket.conn.id)
    socket.emit('poll_games_res', waitingGamesList(client))
  })

  socket.on('game_attempt_join', (data) => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) {
      socket.emit('game_error', {message: 'You are not logged in properly!'})
      socket.emit('force_relog')
      return
    }

    if (!data.gameId) return

    joinGame(client, data.gameId)
  })

  socket.on('leave_game', (data) => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) return
    killGamesClientIsIn(client)

    socket.emit('left_success')
  })

  socket.on('new_game', () => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) {
      socket.emit('game_error', {message: 'You are not logged in properly!'})
      socket.emit('force_relog')
      return
    }

    createNewGame(client)
  })

  socket.on('ship_place', (data) => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) {
      socket.emit('game_error', {message: 'You are not logged in properly!'})
      socket.emit('force_relog')
      return
    }

    if (!data.gameId || !data.ship) return

    let game = games[data.gameId]
    let playerInGame = determinePlayerById(data.gameId, client)

    if (!playerInGame) {
      socket.emit('game_error', {message: 'unexpected error. code: 763'})
      return
    }

    let meObj = game[playerInGame]
    if (meObj.placed === true) {
      socket.emit('game_error', {message: 'Please don\'t cheat.'})
      return
    }

    if (!integrityCheck(data.ship)) {
      socket.emit('game_error', {message: 'Something went wrong when you tried placing a ship.'})
      return
    }

    meObj.ships.push({
      name: data.ship.name,
      sunken: false,
      cells: data.ship.cells
    })

    socket.emit('verified_place', data.ship)

    if (meObj.ships.length === ships.length) {
      meObj.placed = true
      let opponent = determineOpponent(playerInGame)

      if (game[opponent].placed) {
        game.turn = 'player1'
        clients[game.player1.uid].socket.emit('destroy_turn', true)
        clients[game.player2.uid].socket.emit('destroy_turn', false)
      }

      clients[meObj.uid].socket.emit('current_stats', {
        opponentShipsLeft: ships.length - game[opponent].destructions,
        myShipsLeft: ships.length - meObj.destructions
      })
      clients[game[opponent].uid].socket.emit('current_stats', {
        opponentShipsLeft: ships.length - meObj.destructions,
        myShipsLeft: ships.length - game[opponent].destructions
      })
    }
  })

  socket.on('set_bomb', (data) => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) {
      socket.emit('game_error', {message: 'You are not logged in properly!'})
      socket.emit('force_relog')
      return
    }

    let game = games[data.gameId]
    let playerInGame = determinePlayerById(data.gameId, client)

    if (!playerInGame) {
      socket.emit('game_error', {message: 'unexpected error. code: 763'})
      return
    }

    let opponent = determineOpponent(playerInGame)
    let result = attemptToBombTile(playerInGame, opponent, game, data.x, data.y)

    let opponentObj = game[opponent]
    let me = game[playerInGame]

    if (result.ship) {
      clients[opponentObj.uid].socket.emit('update_ship', result.ship)
    }

    clients[me.uid].socket.emit('update_hits', {me: true, strikes: me.strikes})
    clients[me.uid].socket.emit('update_hits', {me: false, strikes: opponentObj.strikes})

    switch (result.event) {
      case 5:
        clients[me.uid].socket.emit('infmessage', 'You\'ve already bombed that tile!')
        break
      case 1:
        clients[me.uid].socket.emit('infmessage', 'You sunk a ship!')
        break
      case 0:
        clients[me.uid].socket.emit('infmessage', 'You destroyed some of the opponents ship!')
        break
      case 2:
        game.turn = opponent
        clients[me.uid].socket.emit('destroy_turn', false)
        clients[opponentObj.uid].socket.emit('destroy_turn', true)
        clients[me.uid].socket.emit('infmessage', 'You missed!')
        break
      case 6:
        clients[opponentObj.uid].socket.emit('display_result', {enemyShips: me.ships, gameId: data.gameId})
        clients[me.uid].socket.emit('display_result', {enemyShips: opponentObj.ships, gameId: data.gameId})
        endGame(data.gameId, client, opponentObj.uid)
        break
    }

    clients[me.uid].socket.emit('current_stats', {
      opponentShipsLeft: ships.length - opponentObj.destructions,
      myShipsLeft: ships.length - me.destructions
    })

    clients[opponentObj.uid].socket.emit('current_stats', {
      opponentShipsLeft: ships.length - me.destructions,
      myShipsLeft: ships.length - opponentObj.destructions
    })
  })

  socket.on('chat_send', (data) => {
    let client = clientsBySocketID(socket.conn.id)
    
    if (!client) {
      socket.emit('game_error', {message: 'You are not logged in properly!'})
      socket.emit('force_relog')
      return
    }

    let game = games[data.gameId]
    let playerInGame = determinePlayerById(data.gameId, client)

    if (!playerInGame) {
      socket.emit('game_error', {message: 'unexpected error. code: 763'})
      return
    }

    let opponent = determineOpponent(playerInGame)
    let opponentObj = game[opponent]
    let me = game[playerInGame]

    clients[opponentObj.uid].socket.emit('chat', {name: clients[me.uid].name, message: data.message})
  })

  socket.on('disconnect', () => {
    let client = clientsBySocketID(socket.conn.id)
    if (!client) return

    killGamesClientIsIn(client)

    console.log('Player uid ' + client + ' left.')

    delete clients[client]
  })
})

server.listen(8000)
