(function ($) {
  let io = window.io.connect()
  let Battleship = {
    DOM: {},
    mobile: false,
    playerName: '',
    playerID: '',
    verified: null,
    locked: false,
    waitlist: [],
    played: 0,
    Game: {
      gameId: null,
      myTurn: true,
      opponentID: '',
      opponentName: '',
      gridHome: {ships: [], strikes: []},
      gridOpponent: []
    }
  }

  let activityNotice = {
    timeout: null,
    doctitle: '',
    focused: true,

    off: (temp) => {
      document.title = activityNotice.doctitle

      clearTimeout(activityNotice.timeout)
      activityNotice.timeout = null
      
      if (temp) {
        activityNotice.timeout = setTimeout(() => {
          activityNotice.on(temp)
        }, 1000)
      }
    },
    on: (msg) => {
      if (activityNotice.timeout) {
        activityNotice.off(null)
      }

      if (activityNotice.focused) return
      
      document.title = msg
      
      activityNotice.timeout = setTimeout(() => {
        activityNotice.off(msg)
      }, 1000)
    }
  }

  window.requestAnimFrame = (function() {
    return window.requestAnimationFrame       ||
           window.webkitRequestAnimationFrame ||
           window.mozRequestAnimationFrame    ||
           function (callback) {
             window.setTimeout(callback, 1000 / 60)
           }
  })()

  function mustacheTempl (tmlTag, data) {
    let html = ''
    const tag = document.querySelector('#' + tmlTag)

    if (!tag) return ''
    html = tag.innerHTML
    html = window.Mustache.to_html(html, data)
    return html
  }
  
  function modalAlert (msg) {
    Battleship.DOM.modalMsg.innerHTML = msg
    Battleship.DOM.alertModal.showModal()
    activityNotice.on(msg)
  }

  function pointerOnCanvas (e) {
    let x
    let y

    if (e.changedTouches) {
      let touch = e.changedTouches[0]
      if (touch) {
        e.pageX = touch.pageX
        e.pageY = touch.pageY
      }
    }

    if (e.pageX || e.pageY) { 
      x = e.pageX
      y = e.pageY
    } else {
      x = e.clientX + document.body.scrollLeft + document.documentElement.scrollLeft
      y = e.clientY + document.body.scrollTop + document.documentElement.scrollTop
    }

    x -= Battleship.DOM.canvas.offsetLeft
    y -= Battleship.DOM.canvas.offsetTop

    return {x: x, y: y}
  }

  let GameDrawer = {
    drawMyBoard: true,
    boardStaticState: null,

    mX: 0,
    mY: 0,

    gridX: 0,
    gridY: 0,

    gridSize: 32,
    mouseOn: false,

    bw: 512,
    bh: 512,

    placingShips: true,
    canPlace: false,
    shipIndex: 0,
    shipOrientation: 0,
    shipTiles: [],

    startGame: () => {
      GameDrawer.placingShips = true
      GameDrawer.canPlace = false
      GameDrawer.shipIndex = 0
      GameDrawer.shipOrientation = 0
      GameDrawer.shipTiles = []

      Battleship.ctx.clearRect(0, 0, Battleship.canvasW, Battleship.canvasH)
      Battleship.Game.myTurn = true

      if (Battleship.mobile) {
        Battleship.DOM.mobRotate.style.display = 'block'
      }

      let p = 0
      let context = Battleship.ctx

      for (let x = 0; x <= GameDrawer.bw; x += GameDrawer.gridSize) {
        context.moveTo(0.5 + x + p, p)
        context.lineTo(0.5 + x + p, GameDrawer.bh + p)
      }

      for (let x = 0; x <= GameDrawer.bh; x += GameDrawer.gridSize) {
        context.moveTo(p, 0.5 + x + p)
        context.lineTo(GameDrawer.bw + p, 0.5 + x + p)
      }

      context.strokeStyle = "black"
      context.stroke()

      GameDrawer.boardStaticState = new Image()
      GameDrawer.boardStaticState.src = Battleship.DOM.canvas.toDataURL()
      GameDrawer.boardStaticState.onload = () => {
        GameDrawer.gameLoop()
      }
    },

    endResultCellRenderer(cells, ctx, ship) {
      for (let i in cells) {
        let cell = cells[i]
        let destVar = (cell.destroyed != null ? cell.destroyed : cell.destroy)
        let color = '#dddd00'
        if (destVar || (ship != null && ship.sunken)) {
          color = '#ff0000'
        } else {
          if (ship) {
            color = '#dddddd'
          }
        }
        ctx.fillStyle = color
        ctx.fillRect(cell.x * GameDrawer.gridSize, cell.y * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
      }
    },

    resultScreen(myShips, enemyShips, myHits, enemyHits) {
      let c1 = Battleship.DOM.resultScreen.querySelector('#opponent_result_canvas')
      let c2 = Battleship.DOM.resultScreen.querySelector('#my_result_canvas')
      let ctx1 = c1.getContext('2d')
      let ctx2 = c2.getContext('2d')

      ctx1.clearRect(0, 0, Battleship.canvasW, Battleship.canvasH)
      ctx2.clearRect(0, 0, Battleship.canvasW, Battleship.canvasH)

      ctx1.drawImage(GameDrawer.boardStaticState, 0, 0)
      ctx2.drawImage(GameDrawer.boardStaticState, 0, 0)

      GameDrawer.endResultCellRenderer(myHits, ctx1, null)

      // Render my ship tiles
      for (let i in myShips) {
        let ship = myShips[i]
        GameDrawer.endResultCellRenderer(ship.cells, ctx2, ship)
      }

      // Render enemy ship tiles
      for (let i in enemyShips) {
        let ship = enemyShips[i]
        GameDrawer.endResultCellRenderer(ship.cells, ctx1, ship)
      }

      GameDrawer.endResultCellRenderer(enemyHits, ctx2, null)
    },

    click: () => {
      if (GameDrawer.placingShips && GameDrawer.canPlace && GameDrawer.shipIndex != -1) {
        let shipData = Battleship.ships[GameDrawer.shipIndex]
        let placed = {
          name: shipData.name,
          sunken: false,
          cells: GameDrawer.shipTiles
        }

        io.emit('ship_place', {ship: placed, gameId: Battleship.Game.gameId})

        if (GameDrawer.shipIndex + 1 < Battleship.ships.length) {
          GameDrawer.shipIndex += 1
        } else {
          GameDrawer.shipIndex = -1
          logStatus('Waiting for opponent')
        }
      } else if (!GameDrawer.placingShips && Battleship.Game.myTurn) {
        io.emit('set_bomb', {x: GameDrawer.gridX, y: GameDrawer.gridY, gameId: Battleship.Game.gameId})
      }
    },

    intersectsExisting: (cx, cy) => {
      let is = false
      for (let i in Battleship.Game.gridHome.ships) {
        let ship = Battleship.Game.gridHome.ships[i]
        for (let j in ship.cells) {
          let cell = ship.cells[j]
          if (cell.x === cx && cell.y === cy) {
            is = true
          }
        }
      }
      return is
    },

    updater: () => {
      if (Battleship.Game.myTurn && !GameDrawer.placingShips) {
        if (GameDrawer.mouseOn) {
          Battleship.ctx.fillStyle = '#f4b002'
          Battleship.ctx.fillRect(GameDrawer.gridX * GameDrawer.gridSize, GameDrawer.gridY * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
        }

        for (let i in Battleship.Game.gridHome.strikes) {
          let strike = Battleship.Game.gridHome.strikes[i]
          if (strike.destroy) {
            Battleship.ctx.fillStyle = '#ff0000'
          } else {
            Battleship.ctx.fillStyle = '#dddd00'
          }
          Battleship.ctx.fillRect(strike.x * GameDrawer.gridSize, strike.y * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
        }
      } else if ((!Battleship.Game.myTurn && !GameDrawer.placingShips) || (Battleship.Game.myTurn && GameDrawer.placingShips)) {
        for (let i in Battleship.Game.gridOpponent) {
          let strike = Battleship.Game.gridOpponent[i]
          Battleship.ctx.fillStyle = '#dddd00'
          Battleship.ctx.fillRect(strike.x * GameDrawer.gridSize, strike.y * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
        }

        for (let i in Battleship.Game.gridHome.ships) {
          let ship = Battleship.Game.gridHome.ships[i]
          for (let j in ship.cells) {
            let cell = ship.cells[j]
            let color = '#dddddd'

            if (cell.destroyed || ship.sunken) {
              color = '#ff0000'
            }

            Battleship.ctx.fillStyle = color
            Battleship.ctx.fillRect(cell.x * GameDrawer.gridSize, cell.y * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
          }
        }
      }

      if (Battleship.Game.myTurn && GameDrawer.placingShips) {
        let shipData = Battleship.ships[GameDrawer.shipIndex]
        
        if (!shipData) return

        let shipCenter = Math.floor(shipData.tiles / 2)

        let cellsOff = 0
        let positions = []
        let color = '#00dd00'

        for (let i = 0; i < shipData.tiles; i++) {
          let sx = 0
          let sy = 0
          i = parseInt(i)

          let rx = 0
          let ry = 0

          if (i < shipCenter) {
            if (GameDrawer.shipOrientation === 0) {
              sx = GameDrawer.gridX - (shipCenter - i)
              sy = GameDrawer.gridY
            } else {
              sx = GameDrawer.gridX
              sy = GameDrawer.gridY - (shipCenter - i)
            }
          } else if (i === shipCenter) {
            sx = GameDrawer.gridX
            sy = GameDrawer.gridY
          } else {
            if (GameDrawer.shipOrientation === 0) {
              sx = GameDrawer.gridX + (i - shipCenter)
              sy = GameDrawer.gridY
            } else {
              sx = GameDrawer.gridX
              sy = GameDrawer.gridY + (i - shipCenter)
            }
          }

          if (sx < 0 || sy < 0 || sx > 15 || sy > 15) {
            cellsOff += 1
          }

          if (GameDrawer.intersectsExisting(sx, sy)) {
            cellsOff += 1
          }

          positions.push({x: sx, y: sy, destroyed: false})
        }

        for (let i in positions) {
          let pos = positions[i]

          if (cellsOff > 0) {
            color = '#dd0000'
            GameDrawer.canPlace = false
          } else {
            GameDrawer.canPlace = true
          }

          Battleship.ctx.fillStyle = color
          Battleship.ctx.fillRect(pos.x * GameDrawer.gridSize, pos.y * GameDrawer.gridSize, GameDrawer.gridSize, GameDrawer.gridSize)
        }

        GameDrawer.shipTiles = positions
      }
    },

    clearCanvas: () => {
      Battleship.ctx.clearRect(0, 0, Battleship.canvasW, Battleship.canvasH)
      Battleship.ctx.drawImage(GameDrawer.boardStaticState, 0, 0)
    },

    gameLoop: () => {
      GameDrawer.clearCanvas()
      if (!Battleship.Game.gameId) return

      GameDrawer.updater()

      requestAnimFrame(GameDrawer.gameLoop)
    },

    rotate: () => {
      if (GameDrawer.placingShips) {
        if (GameDrawer.shipOrientation === 0) {
          GameDrawer.shipOrientation = 1
        } else {
          GameDrawer.shipOrientation = 0
        }
      } 
    },

    initialize: () => {
      Battleship.DOM.canvas.addEventListener('mousemove', (e) => {
        let posOnCanvas = pointerOnCanvas(e)
        GameDrawer.mX = posOnCanvas.x
        GameDrawer.mY = posOnCanvas.y
        GameDrawer.mouseOn = true

        let rowCount = GameDrawer.gridSize

        GameDrawer.gridX = Math.floor(GameDrawer.mX / rowCount)
        GameDrawer.gridY = Math.floor(GameDrawer.mY / rowCount)
      })

      Battleship.DOM.canvas.addEventListener('mouseleave', (e) => {
        GameDrawer.mouseOn = false
      })

      Battleship.DOM.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault()

        GameDrawer.rotate()

        return false
      })

      Battleship.DOM.canvas.addEventListener('click', (e) => {
        GameDrawer.click()
      })

      Battleship.DOM.canvas.addEventListener('keydown', (e) => {
        if (e.keyCode === 82) {
          GameDrawer.rotate()
        }
      })

      Battleship.DOM.mobRotate.addEventListener('click', (e) => {
        GameDrawer.rotate()
      })
    }
  }

  function getStored (variable) {
    let result = null
    if (!window.localStorage) {
      return null
    }

    if (window.localStorage.game_store) {
      try {
        let obj = JSON.parse(window.localStorage.game_store)
        if (obj[variable] != null) {
          result = obj[variable]
        }
      } catch (e) {
        result = null
      }
    }

    return result
  }

  function storeVar (variable, value) {
    if (!window.localStorage) {
      return null
    }

    if (window.localStorage.game_store) {
      try {
        let obj = JSON.parse(window.localStorage.game_store)
        obj[variable] = value
        window.localStorage.game_store = JSON.stringify(obj)
      } catch (e) {
        return null
      }
    } else {
      let obj = {}
      obj[variable] = value
      window.localStorage.game_store = JSON.stringify(obj)
    }
  }

  function playerNameValidation (name) {
    if (/^([A-Z0-9_\-@]{3,20})$/i.test(name)) {
      return true
    }
    return false
  }

  function logWarning (msg) {
    Battleship.DOM.joinWarn.innerHTML = msg
  }

  function logStatus (msg) {
    Battleship.DOM.statusCurrent.innerHTML = msg
  }

  function joinGame (game) {
    Battleship.played += 1

    activityNotice.on('Game has started!')
    //io.emit('leave_game', {gameId: Battleship.Game.gameId})
    Battleship.Game.gameId = game.gameId
    Battleship.Game.opponentID = game.opponentId
    Battleship.Game.opponentName = game.opponentName
    Battleship.DOM.opponentName.innerHTML = game.opponentName

    Battleship.DOM.chatbox.innerHTML = ''

    io.emit('game_poll', {gameId: Battleship.Game.gameId})

    logStatus('Place your ships onto the board.<br>Right Click to rotate')

    Battleship.DOM.gameScreen.style.display = 'block'
    Battleship.DOM.selectionScreen.style.display = 'none'
    Battleship.DOM.waitlistBtns.style.display = 'block'
    Battleship.DOM.waitlistQuit.style.display = 'none'
    GameDrawer.startGame()
    addChatMessage('event', null, 'Game started!')
  }

  function attemptJoin (name) {
    if (Battleship.locked) return
    if (!io.connected) {
      return logWarning('Disconnected from server socket.')
    }

    if (playerNameValidation(name) == false) {
      return logWarning('Username not allowed.')
    }

    logWarning('Attempting to join..')
    Battleship.locked = true
    io.emit('session_create', {name: name})
  }

  function joinSuccess (data) {
    Battleship.playerName = data.name
    Battleship.playerID = data.uid
    Battleship.DOM.selectionScreen.style.display = 'block'

    storeVar('name', data.name)
    io.emit('poll_games')
    Battleship.locked = false
  }

  function joinResponse (data) {
    if (data.success !== true) {
      Battleship.locked = false
      return logWarning(data.message)
    }

    Battleship.DOM.startScreen.style.display = 'none'

    joinSuccess(data)
  }

  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
  }

  function constructWaitList() {
    let finalML = ''
    for (let i in Battleship.waitlist) {
      let game = Battleship.waitlist[i]
      finalML += mustacheTempl('waitlistInstance', game)
    }
    waitlist.innerHTML = finalML
  }

  window.joinWaiting = (gameId) => {
    if (Battleship.Game.gameId) return
    io.emit('game_attempt_join', {gameId: gameId})
  }

  function gameEnds (reason, winner) {
    if (reason === 1) {
      if (winner === true) {
        activityNotice.on('You won!')
        Battleship.DOM.winStatus.innerHTML = 'Won'
      } else {
        activityNotice.on('You lost.')
        Battleship.DOM.winStatus.innerHTML = 'Lost'
      }
    }

    if (reason === 0 && winner === true) {
      modalAlert('Your opponent left the game.')
    }

    Battleship.locked = false
    Battleship.Game.gameId = null
    io.emit('poll_games')

    Battleship.DOM.gameScreen.style.display = 'none'
    if (reason === 1) {
      Battleship.DOM.resultScreen.style.display = 'block'
    } else {
      Battleship.DOM.selectionScreen.style.display = 'block'
      Battleship.DOM.resultScreen.style.display = 'none'
    }

    Battleship.DOM.waitlistBtns.style.display = 'block'
    Battleship.DOM.waitlistQuit.style.display = 'none'

    Battleship.Game.gridHome = {ships: [], strikes: []}
    Battleship.Game.gridOpponent = []

    Battleship.DOM.dataOpponentDestroyed.innerHTML = '0'
    Battleship.DOM.dataMineDestroyed.innerHTML = '0'
  }

  function forceRelogin () {
    logWarning('Please log in again.')
    Battleship.DOM.gameScreen.style.display = 'none'
    Battleship.DOM.selectionScreen.style.display = 'none'
    Battleship.DOM.startScreen.style.display = 'block'
    Battleship.DOM.resultScreen.style.display = 'none'

    Battleship.locked = false
    Battleship.playerName = ''
    Battleship.Game.gameId = null
  }

  function escapeHtml(unsafe) {
    return unsafe
           .replace(/&/g, "&amp;")
           .replace(/</g, "&lt;")
           .replace(/>/g, "&gt;")
           .replace(/"/g, "&quot;")
           .replace(/'/g, "&#039;")
  }

  function addChatMessage (type, senderName, message) {
    if (type === 'chat') {
      activityNotice.on('Chat message!')
    }

    let msgElem = '<div class="message t_' + type + '">'
    
    if (senderName) {
      msgElem += '<span class="sender">' + senderName + '</span>&nbsp;'
    }
    
    msgElem += '<span class="line">' + escapeHtml(message) + '</span>'

    Battleship.DOM.chatbox.innerHTML += msgElem
    Battleship.DOM.chatbox.scrollTop = Battleship.DOM.chatbox.scrollHeight
  }

  function unsupportedModalFix (elem) {
    if (!elem.showModal) {
      elem.className = 'unsupported'
      elem.showModal = () => {
        elem.style.display = 'block'
      }
      elem.close = () => {
        elem.style.display = 'none'
      }
    }
  }

  window.onfocus = () => {
    activityNotice.focused = true
    activityNotice.off(null)
  }

  window.onblur = () => {
    activityNotice.focused = false
  }

  window.onload = () => {
    const startScreen = Battleship.DOM.startScreen = $.querySelector('#start')
    const selectionScreen = Battleship.DOM.selectionScreen = $.querySelector('#selection')
    const gameScreen = Battleship.DOM.gameScreen = $.querySelector('#game')
    const resultScreen = Battleship.DOM.resultScreen = $.querySelector('#endresult')

    const warning = Battleship.DOM.joinWarn = startScreen.querySelector('#warning_message')
    const playerName = startScreen.querySelector('#player_name')
    const startButton = startScreen.querySelector('#sock_player_init')

    const waitlist = Battleship.DOM.waitlist = selectionScreen.querySelector('#waitlist')
    const random = selectionScreen.querySelector('#waitlist_join_random')
    const newGame = selectionScreen.querySelector('#waitlist_join')
    const refresh = selectionScreen.querySelector('#waitlist_join_refresh')

    const waitlistQuit = Battleship.DOM.waitlistQuit = selectionScreen.querySelector('#waitlist_quit')
    const waitlistBtns = Battleship.DOM.waitlistBtns = selectionScreen.querySelector('.idbuttons')

    const stat_online = selectionScreen.querySelector('#stats_players_online')
    const stat_ingame = selectionScreen.querySelector('#stats_players')
    const stat_total = selectionScreen.querySelector('#stats_games')
    const stat_client = selectionScreen.querySelector('#stats_clientgames')

    const leaveBtn = gameScreen.querySelector('#leave')
    const opponentName = Battleship.DOM.opponentName = gameScreen.querySelector('#opponent_name')

    let canvas = Battleship.DOM.canvas = gameScreen.querySelector('#game_canvas')
    let ctx = Battleship.ctx = canvas.getContext('2d')

    Battleship.canvasW = canvas.width
    Battleship.canvasH = canvas.height

    const dataOpponentDestroyed = Battleship.DOM.dataOpponentDestroyed = gameScreen.querySelector('#o_s_num')
    const dataMineDestroyed = Battleship.DOM.dataMineDestroyed = gameScreen.querySelector('#g_s_num')
    Battleship.DOM.statusCurrent = gameScreen.querySelector('#g_s_stat')

    const doneBtn = resultScreen.querySelector('#lobby')
    Battleship.DOM.winStatus = resultScreen.querySelector('#wonlost')

    const chatbox = Battleship.DOM.chatbox = gameScreen.querySelector('#messages')
    const chatfield = Battleship.DOM.chatfield = gameScreen.querySelector('#message_send')

    const alertModal = Battleship.DOM.alertModal = $.querySelector('#alertModal')
    const alertClose = alertModal.querySelector('#close')
    Battleship.DOM.modalMsg = alertModal.querySelector('#am_text')
    unsupportedModalFix(alertModal)

    const mobRotate = Battleship.DOM.mobRotate = gameScreen.querySelector('#mob_rotate')

    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|BB|PlayBook|IEMobile|Windows Phone|Kindle|Silk|Opera Mini/i.test(navigator.userAgent)) {
      Battleship.mobile = true
    }

    GameDrawer.initialize()

    let uname = getStored('name')
    if (uname) {
      playerName.value = uname
    }

    playerName.addEventListener('keydown', (e) => {
      if (e.keyCode === 13) {
        attemptJoin(playerName.value)
      }
    }, false)

    alertClose.addEventListener('click', () => {
      alertModal.close()
    })

    chatfield.addEventListener('keydown', (e) => {
      if (e.keyCode === 13 && Battleship.Game.gameId) {
        if (chatfield.value != '') {
          io.emit('chat_send', {message: chatfield.value, gameId: Battleship.Game.gameId})
          addChatMessage('chat me', Battleship.playerName, chatfield.value)
          chatfield.value = ''
        }
      }
    })

    chatbox.addEventListener('click', (e) => {
      chatfield.focus()
    })
 
    startButton.addEventListener('click', (e) => {
      attemptJoin(playerName.value)
    }, false)

    newGame.addEventListener('click', (e) => {
      if (Battleship.locked) return
      if (Battleship.Game.gameId) return
      io.emit('new_game')
      Battleship.locked = true
    })

    refresh.addEventListener('click', (e) => {
      if (Battleship.locked) return
      io.emit('poll_games')
    })

    doneBtn.addEventListener('click', (e) => {
      gameEnds(0, null)
    })

    waitlistQuit.addEventListener('click', (e) => {
      io.emit('leave_game', {gameId: Battleship.Game.gameId})
    })

    leaveBtn.addEventListener('click', (e) => {
      io.emit('leave_game', {gameId: Battleship.Game.gameId})
    })

    random.addEventListener('click', (e) => {
      Battleship.joinRandomWhenDone = true
      io.emit('poll_games')
    })

    io.on('destroy_turn', (val) => {
      if (GameDrawer.placingShips) {
        Battleship.DOM.mobRotate.style.display = 'none'
        GameDrawer.placingShips = false
      }

      if (val === true) {
        Battleship.Game.myTurn = true
        logStatus('It\'s your turn!')
      } else {
        Battleship.Game.myTurn = false
        logStatus(Battleship.Game.opponentName + '\'s turn.')
      }
    })

    io.on('chat', (data) => {
      addChatMessage('chat', data.name, data.message)
    })

    io.on('update_hits', (data) => {
      if (data.me) {
        Battleship.Game.gridHome.strikes = data.strikes
      } else {
        Battleship.Game.gridOpponent = data.strikes
      }
    })

    io.on('update_ship', (dship) => {
      for (let i in Battleship.Game.gridHome.ships) {
        let ship = Battleship.Game.gridHome.ships[i]
        if (ship.name === dship.name) {
          for (let j in ship.cells) {
            let cell = ship.cells[j]
            cell.destroyed = dship.cells[j].destroyed
          }
          ship.sunken = dship.sunken

          if (ship.sunken) {
            logStatus('Opponent sunk one of your ships!')
          }
        }
      }
    })

    io.on('infmessage', (message) => {
      logStatus(message)
    })

    io.on('game_settings', (data) => {
      Battleship.ships = data.ships
    })

    io.on('verified_place', (ship) => {
      Battleship.Game.gridHome.ships.push(ship)
    })

    io.on('game_start', (data) => {
      joinGame(data)
    })

    io.on('left_success', () => {
      gameEnds(0, null)
    })

    io.on('game_error', (data) => {
      modalAlert(data.message)
      gameEnds(0, null)
      io.emit('poll_games')
    })

    io.on('force_relog', () => {
      forceRelogin()
    })

    io.on('display_result', (data) => {
      GameDrawer.resultScreen(Battleship.Game.gridHome.ships, data.enemyShips, Battleship.Game.gridHome.strikes, Battleship.Game.gridOpponent)
    })

    io.on('game_end', (data) => {
      gameEnds(data.result, data.win)
    })

    io.on('game_new_done', (data) => {
      Battleship.locked = true
      Battleship.DOM.waitlist.innerHTML = '<div class="green">Waiting for an opponent..</div>'
      Battleship.DOM.waitlistBtns.style.display = 'none'
      Battleship.DOM.waitlistQuit.style.display = 'block'
      Battleship.Game.gameId = data.gameId
    })

    io.on('current_stats', (data) => {
      dataOpponentDestroyed.innerHTML = data.opponentShipsLeft
      dataMineDestroyed.innerHTML = data.myShipsLeft
    })

    io.on('login_status', joinResponse)
    io.on('poll_games_res', (data) => {
      Battleship.DOM.waitlistQuit.style.display = 'none'
      
      let list = data.list

      if (data.sessions != null) {
        stat_ingame.innerHTML = data.sessions
      }

      if (data.totalGames != null) {
        stat_total.innerHTML = data.totalGames
      }

      if (data.online != null) {
        stat_online.innerHTML = data.online
      }

      stat_client.innerHTML = Battleship.played

      if (!list.length) {
        waitlist.innerHTML = '<div class="red">No people currently waiting, press <b>Join Wait List</b> to enter.</div>'
        Battleship.waitlist = []

        if(Battleship.joinRandomWhenDone) {
          delete Battleship.joinRandomWhenDone
        }

        return
      }

      Battleship.waitlist = list

      if (Battleship.joinRandomWhenDone && Battleship.waitlist.length) {
        delete Battleship.joinRandomWhenDone

        let rand = getRandomInt(1, Battleship.waitlist.length)

        io.emit('game_attempt_join', {gameId: Battleship.waitlist[rand - 1].gameId})
      }

      constructWaitList()
    })

    io.on('disconnect', () => {
      gameEnds(0, null)
      forceRelogin()
      logWarning('Server disconnected')
    })

    activityNotice.doctitle = document.title
  }
})(document)
