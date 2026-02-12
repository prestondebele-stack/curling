// ============================================================
// CURLING NETWORK - Client-side WebSocket manager
// ============================================================

const CurlingNetwork = (() => {
    let ws = null;
    let serverUrl = null;
    let myTeam = null;
    let roomCode = null;
    let reconnectAttempts = 0;
    let reconnectTimer = null;
    let heartbeatTimer = null;
    let intentionalClose = false;

    // Event callbacks
    const callbacks = {
        onGameStart: null,
        onOpponentThrow: null,
        onOpponentSweepChange: null,
        onOpponentSweepStart: null,
        onOpponentSweepStop: null,
        onOpponentDisconnected: null,
        onOpponentReconnected: null,
        onOpponentLeft: null,
        onRematchRequested: null,
        onRematchAccepted: null,
        onRoomCreated: null,
        onRoomJoined: null,
        onRoomError: null,
        onQueueWaiting: null,
        onRoomExpired: null,
        onDisconnect: null,
        onReconnected: null,
        onReconnectFailed: null,
    };

    function send(data) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(data));
        }
    }

    function startHeartbeat() {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            send({ type: 'ping' });
        }, 5000);
    }

    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function handleMessage(event) {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        switch (data.type) {
            case 'pong':
                break;

            case 'room_created':
                roomCode = data.code;
                if (callbacks.onRoomCreated) callbacks.onRoomCreated({ code: data.code });
                break;

            case 'room_joined':
                roomCode = data.code;
                if (callbacks.onRoomJoined) callbacks.onRoomJoined({ code: data.code });
                break;

            case 'room_not_found':
                if (callbacks.onRoomError) callbacks.onRoomError({ error: 'Room not found', code: data.code });
                break;

            case 'room_full':
                if (callbacks.onRoomError) callbacks.onRoomError({ error: 'Room is full', code: data.code });
                break;

            case 'queue_waiting':
                if (callbacks.onQueueWaiting) callbacks.onQueueWaiting();
                break;

            case 'game_start':
                myTeam = data.yourTeam;
                reconnectAttempts = 0;
                if (callbacks.onGameStart) callbacks.onGameStart({ yourTeam: data.yourTeam });
                break;

            case 'opponent_throw':
                if (callbacks.onOpponentThrow) {
                    callbacks.onOpponentThrow({
                        aim: data.aim,
                        weight: data.weight,
                        spinDir: data.spinDir,
                        spinAmount: data.spinAmount,
                    });
                }
                break;

            case 'opponent_sweep_change':
                if (callbacks.onOpponentSweepChange) callbacks.onOpponentSweepChange({ level: data.level });
                break;

            case 'opponent_sweep_start':
                if (callbacks.onOpponentSweepStart) callbacks.onOpponentSweepStart();
                break;

            case 'opponent_sweep_stop':
                if (callbacks.onOpponentSweepStop) callbacks.onOpponentSweepStop();
                break;

            case 'opponent_disconnected':
                if (callbacks.onOpponentDisconnected) callbacks.onOpponentDisconnected();
                break;

            case 'opponent_reconnected':
                if (callbacks.onOpponentReconnected) callbacks.onOpponentReconnected();
                break;

            case 'opponent_left':
                if (callbacks.onOpponentLeft) callbacks.onOpponentLeft();
                break;

            case 'rematch_requested':
                if (callbacks.onRematchRequested) callbacks.onRematchRequested();
                break;

            case 'rematch_accepted':
                myTeam = data.yourTeam;
                if (callbacks.onRematchAccepted) callbacks.onRematchAccepted({ yourTeam: data.yourTeam });
                break;

            case 'reconnected':
                myTeam = data.yourTeam;
                reconnectAttempts = 0;
                if (callbacks.onReconnected) callbacks.onReconnected({ yourTeam: data.yourTeam });
                break;

            case 'reconnect_failed':
                if (callbacks.onReconnectFailed) callbacks.onReconnectFailed();
                break;

            case 'room_expired':
                if (callbacks.onRoomExpired) callbacks.onRoomExpired();
                break;
        }
    }

    function attemptReconnect() {
        if (reconnectAttempts >= 5 || !roomCode) {
            if (callbacks.onReconnectFailed) callbacks.onReconnectFailed();
            return;
        }

        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 16000);

        reconnectTimer = setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) return;

            const newWs = new WebSocket(serverUrl);

            newWs.onopen = () => {
                ws = newWs;
                ws.onmessage = handleMessage;
                ws.onclose = handleClose;
                ws.onerror = () => {};
                startHeartbeat();
                // Try to rejoin room
                send({ type: 'reconnect', code: roomCode });
            };

            newWs.onerror = () => {
                attemptReconnect();
            };

            newWs.onclose = () => {
                if (reconnectAttempts < 5) {
                    attemptReconnect();
                }
            };
        }, delay);
    }

    function handleClose() {
        stopHeartbeat();
        if (!intentionalClose && roomCode) {
            if (callbacks.onDisconnect) callbacks.onDisconnect();
            attemptReconnect();
        }
    }

    // Public API
    return {
        connect(url) {
            serverUrl = url;
            intentionalClose = false;

            return new Promise((resolve, reject) => {
                try {
                    ws = new WebSocket(url);
                } catch (e) {
                    reject(e);
                    return;
                }

                ws.onopen = () => {
                    reconnectAttempts = 0;
                    startHeartbeat();
                    resolve();
                };

                ws.onmessage = handleMessage;
                ws.onclose = handleClose;
                ws.onerror = () => {
                    reject(new Error('WebSocket connection failed'));
                };
            });
        },

        disconnect() {
            intentionalClose = true;
            stopHeartbeat();
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (ws) {
                ws.close();
                ws = null;
            }
            myTeam = null;
            roomCode = null;
            reconnectAttempts = 0;
        },

        isConnected() {
            return ws && ws.readyState === WebSocket.OPEN;
        },

        // Lobby
        createRoom() { send({ type: 'create_room' }); },
        joinRoom(code) { send({ type: 'join_room', code: code.toUpperCase() }); },
        joinQueue() { send({ type: 'join_queue' }); },
        leaveQueue() { send({ type: 'leave_queue' }); },

        // Gameplay
        sendThrow(params) {
            send({ type: 'throw', aim: params.aim, weight: params.weight, spinDir: params.spinDir, spinAmount: params.spinAmount });
        },
        sendSweepChange(level) { send({ type: 'sweep_change', level }); },
        sendSweepStart() { send({ type: 'sweep_start' }); },
        sendSweepStop() { send({ type: 'sweep_stop' }); },
        sendTurnComplete() { send({ type: 'turn_complete' }); },
        sendRematch() { send({ type: 'rematch' }); },
        sendLeave() { send({ type: 'leave' }); },

        // Event registration
        onGameStart(cb) { callbacks.onGameStart = cb; },
        onOpponentThrow(cb) { callbacks.onOpponentThrow = cb; },
        onOpponentSweepChange(cb) { callbacks.onOpponentSweepChange = cb; },
        onOpponentSweepStart(cb) { callbacks.onOpponentSweepStart = cb; },
        onOpponentSweepStop(cb) { callbacks.onOpponentSweepStop = cb; },
        onOpponentDisconnected(cb) { callbacks.onOpponentDisconnected = cb; },
        onOpponentReconnected(cb) { callbacks.onOpponentReconnected = cb; },
        onOpponentLeft(cb) { callbacks.onOpponentLeft = cb; },
        onRematchRequested(cb) { callbacks.onRematchRequested = cb; },
        onRematchAccepted(cb) { callbacks.onRematchAccepted = cb; },
        onRoomCreated(cb) { callbacks.onRoomCreated = cb; },
        onRoomJoined(cb) { callbacks.onRoomJoined = cb; },
        onRoomError(cb) { callbacks.onRoomError = cb; },
        onQueueWaiting(cb) { callbacks.onQueueWaiting = cb; },
        onRoomExpired(cb) { callbacks.onRoomExpired = cb; },
        onDisconnect(cb) { callbacks.onDisconnect = cb; },
        onReconnected(cb) { callbacks.onReconnected = cb; },
        onReconnectFailed(cb) { callbacks.onReconnectFailed = cb; },

        // State
        getMyTeam() { return myTeam; },
        getRoomCode() { return roomCode; },
    };
})();
