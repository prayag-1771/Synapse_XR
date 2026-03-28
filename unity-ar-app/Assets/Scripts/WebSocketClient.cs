using UnityEngine;
using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Net.WebSockets;

[Serializable]
public class Landmark
{
    public float x;
    public float y;
    public float z;
}

[Serializable]
public class HandData
{
    public string type;
    public string source;
    public string hand;
    public string sessionId;
    public Landmark[] landmarks;
    public long timestamp;
}

[Serializable]
public class VoiceTranscript
{
    public string text;
    public long timestamp;
}

[Serializable]
public class GesturePayload
{
    public string gesture;
    public float confidence;
}

[Serializable]
public class SessionParticipant
{
    public string userId;
    public string socketId;
    public string sessionId;
}

public class WebSocketClient : MonoBehaviour
{
    public static WebSocketClient Instance { get; private set; }

    [Header("Server Connection")]
    public string serverUrl = "ws://localhost:5000/socket.io/?EIO=4&transport=websocket";

    [Header("Authentication")]
    [Tooltip("JWT auth token. Leave empty when using guest mode.")]
    public string authToken = "";

    [Header("Session")]
    [Tooltip("Session ID to join after connecting. Get this from the expert dashboard.")]
    public string sessionId = "";

    [Header("Guest / Demo Mode")]
    [Tooltip("Enable guest mode for development. Connects without JWT authentication.")]
    public bool guestMode = true;

    public static event Action<HandData> OnHandDataReceived;
    public static event Action<VoiceTranscript> OnVoiceTranscriptReceived;
    public static event Action<GesturePayload> OnGestureReceived;
    public static event Action<SessionParticipant> OnParticipantJoined;
    public static event Action<SessionParticipant> OnParticipantLeft;
    public static event Action OnSessionEnded;
    public static event Action<bool> OnConnectionChanged;
    public static event Action OnSessionJoined;

    [Header("Reconnection")]
    public float reconnectDelay = 2f;
    public float maxReconnectDelay = 30f;
    public int maxReconnectAttempts = 0; // 0 = unlimited

    private ClientWebSocket ws;
    private readonly Queue<string> messageQueue = new Queue<string>();
    private CancellationTokenSource cts;
    private bool isRunning;
    private bool isConnected;
    private bool hasCompletedHandshake;
    private int reconnectAttempts;
    private float currentReconnectDelay;

    private void Awake()
    {
        if (Instance == null)
        {
            Instance = this;
        }
        else
        {
            Destroy(gameObject);
            return;
        }
    }

    void Start()
    {
        currentReconnectDelay = reconnectDelay;
        Connect();
    }

    /// <summary>
    /// Build the WebSocket URL with authentication parameters.
    /// </summary>
    private string BuildConnectionUrl()
    {
        string baseUrl = serverUrl;

        if (guestMode)
        {
            // Add guest mode query param for Socket.IO auth
            if (baseUrl.Contains("?"))
                baseUrl += "&mode=demo";
            else
                baseUrl += "?mode=demo";
        }
        else if (!string.IsNullOrEmpty(authToken))
        {
            // Add auth token as query param (Socket.IO will read from handshake)
            if (baseUrl.Contains("?"))
                baseUrl += "&token=" + Uri.EscapeDataString(authToken);
            else
                baseUrl += "?token=" + Uri.EscapeDataString(authToken);
        }

        return baseUrl;
    }

    private async void Connect()
    {
        cts?.Cancel();
        cts?.Dispose();
        cts = new CancellationTokenSource();
        var token = cts.Token;

        ws?.Dispose();
        ws = new ClientWebSocket();
        isRunning = true;
        hasCompletedHandshake = false;

        string url = BuildConnectionUrl();

        try
        {
            await ws.ConnectAsync(new Uri(url), token);
            Debug.Log("[WS] Connected to server");
            isConnected = true;
            reconnectAttempts = 0;
            currentReconnectDelay = reconnectDelay;
            OnConnectionChanged?.Invoke(true);
            ReceiveLoop(token);
        }
        catch (Exception e)
        {
            if (token.IsCancellationRequested) return;
            Debug.LogWarning("[WS] Connection failed: " + e.Message);
            isConnected = false;
            OnConnectionChanged?.Invoke(false);
            ScheduleReconnect();
        }
    }

    private async void ReceiveLoop(CancellationToken token)
    {
        var buffer = new byte[8192];
        var messageBuffer = new StringBuilder();

        while (isRunning && ws != null && ws.State == WebSocketState.Open && !token.IsCancellationRequested)
        {
            try
            {
                var result = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    Debug.Log("[WS] Server closed connection");
                    break;
                }

                messageBuffer.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

                // Only process when we have the full message
                if (result.EndOfMessage)
                {
                    string msg = messageBuffer.ToString();
                    messageBuffer.Clear();
                    lock (messageQueue) { messageQueue.Enqueue(msg); }
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception e)
            {
                if (!token.IsCancellationRequested)
                    Debug.LogWarning("[WS] Receive error: " + e.Message);
                break;
            }
        }

        // Connection lost — attempt reconnect
        if (isRunning && !token.IsCancellationRequested)
        {
            isConnected = false;
            hasCompletedHandshake = false;
            OnConnectionChanged?.Invoke(false);
            ScheduleReconnect();
        }
    }

    private void ScheduleReconnect()
    {
        if (!isRunning) return;
        if (maxReconnectAttempts > 0 && reconnectAttempts >= maxReconnectAttempts)
        {
            Debug.LogError("[WS] Max reconnect attempts reached");
            return;
        }

        reconnectAttempts++;
        Debug.Log($"[WS] Reconnecting in {currentReconnectDelay:F1}s (attempt {reconnectAttempts})...");
        Invoke(nameof(Connect), currentReconnectDelay);

        // Exponential backoff capped at max
        currentReconnectDelay = Mathf.Min(currentReconnectDelay * 2f, maxReconnectDelay);
    }

    void Update()
    {
        lock (messageQueue)
        {
            while (messageQueue.Count > 0)
            {
                string msg = messageQueue.Dequeue();
                ProcessMessage(msg);
            }
        }
    }

    void ProcessMessage(string msg)
    {
        // Engine.IO v4 protocol
        if (msg == "2")
        {
            // Ping -> Pong
            SendRaw("3");
            return;
        }

        if (msg.StartsWith("0"))
        {
            // Open -> Send Socket.IO Connect with auth
            if (guestMode)
            {
                SendRaw("40{\"mode\":\"demo\"}");
            }
            else if (!string.IsNullOrEmpty(authToken))
            {
                SendRaw("40{\"token\":\"" + authToken + "\"}");
            }
            else
            {
                SendRaw("40");
            }
            return;
        }

        if (msg.StartsWith("40"))
        {
            // Socket.IO connected acknowledgement
            Debug.Log("[WS] Socket.IO handshake complete");
            hasCompletedHandshake = true;

            // Auto-join session if a session ID is configured
            if (!string.IsNullOrEmpty(sessionId))
            {
                JoinSession(sessionId);
            }
            return;
        }

        // 42["event", { payload }]
        if (msg.StartsWith("42"))
        {
            ParseSocketIOEvent(msg);
        }
    }

    /// <summary>
    /// Join a session room on the server. Call after Socket.IO handshake is complete.
    /// </summary>
    public void JoinSession(string newSessionId)
    {
        if (!hasCompletedHandshake)
        {
            Debug.LogWarning("[WS] Cannot join session — Socket.IO handshake not complete yet");
            sessionId = newSessionId; // Store for auto-join after handshake
            return;
        }

        sessionId = newSessionId;
        string payload = "{\"sessionId\":\"" + sessionId + "\"}";
        SendRaw("42[\"session:join\"," + payload + "]");
        Debug.Log("[WS] Joining session: " + sessionId);
        OnSessionJoined?.Invoke();
    }

    private void ParseSocketIOEvent(string msg)
    {
        // Format: 42["eventName",{json}]

        // ─── hand:data ──────────────────────────────────────────
        const string handPrefix = "42[\"hand:data\",";
        if (msg.StartsWith(handPrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(handPrefix.Length, msg.Length - handPrefix.Length - 1);
            try
            {
                HandData data = JsonUtility.FromJson<HandData>(jsonBody);
                if (data != null && data.landmarks != null && data.landmarks.Length == 21)
                {
                    OnHandDataReceived?.Invoke(data);
                }
            }
            catch (Exception e)
            {
                Debug.LogError("[WS] HandData parse error: " + e.Message);
            }
            return;
        }

        // ─── voice:transcript ───────────────────────────────────
        const string voicePrefix = "42[\"voice:transcript\",";
        if (msg.StartsWith(voicePrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(voicePrefix.Length, msg.Length - voicePrefix.Length - 1);
            try
            {
                VoiceTranscript data = JsonUtility.FromJson<VoiceTranscript>(jsonBody);
                if (data != null && !string.IsNullOrEmpty(data.text))
                {
                    OnVoiceTranscriptReceived?.Invoke(data);
                    Debug.Log("[WS] Voice transcript: " + data.text);
                }
            }
            catch (Exception e)
            {
                Debug.LogError("[WS] VoiceTranscript parse error: " + e.Message);
            }
            return;
        }

        // ─── gesture:detected ───────────────────────────────────
        const string gesturePrefix = "42[\"gesture:detected\",";
        if (msg.StartsWith(gesturePrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(gesturePrefix.Length, msg.Length - gesturePrefix.Length - 1);
            try
            {
                GesturePayload data = JsonUtility.FromJson<GesturePayload>(jsonBody);
                if (data != null)
                {
                    OnGestureReceived?.Invoke(data);
                }
            }
            catch (Exception e)
            {
                Debug.LogError("[WS] GesturePayload parse error: " + e.Message);
            }
            return;
        }

        // ─── session:participant-joined ─────────────────────────
        const string joinedPrefix = "42[\"session:participant-joined\",";
        if (msg.StartsWith(joinedPrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(joinedPrefix.Length, msg.Length - joinedPrefix.Length - 1);
            try
            {
                SessionParticipant data = JsonUtility.FromJson<SessionParticipant>(jsonBody);
                if (data != null)
                {
                    OnParticipantJoined?.Invoke(data);
                    Debug.Log("[WS] Participant joined: " + data.userId);
                }
            }
            catch (Exception e)
            {
                Debug.LogError("[WS] ParticipantJoined parse error: " + e.Message);
            }
            return;
        }

        // ─── session:participant-left ───────────────────────────
        const string leftPrefix = "42[\"session:participant-left\",";
        if (msg.StartsWith(leftPrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(leftPrefix.Length, msg.Length - leftPrefix.Length - 1);
            try
            {
                SessionParticipant data = JsonUtility.FromJson<SessionParticipant>(jsonBody);
                if (data != null)
                {
                    OnParticipantLeft?.Invoke(data);
                    Debug.Log("[WS] Participant left: " + data.userId);
                }
            }
            catch (Exception e)
            {
                Debug.LogError("[WS] ParticipantLeft parse error: " + e.Message);
            }
            return;
        }

        // ─── session:end ────────────────────────────────────────
        const string endPrefix = "42[\"session:end\",";
        if (msg.StartsWith(endPrefix))
        {
            Debug.Log("[WS] Session ended by remote");
            OnSessionEnded?.Invoke();
            return;
        }

        // ─── error:event ────────────────────────────────────────
        const string errorPrefix = "42[\"error:event\",";
        if (msg.StartsWith(errorPrefix) && msg.EndsWith("]"))
        {
            string jsonBody = msg.Substring(errorPrefix.Length, msg.Length - errorPrefix.Length - 1);
            Debug.LogWarning("[WS] Server error: " + jsonBody);
            return;
        }
    }

    public void SendGesture(string gestureName, float confidence = 1.0f)
    {
        string payload = $"{{\"gesture\":\"{gestureName}\",\"confidence\":{confidence:F2}";
        if (!string.IsNullOrEmpty(sessionId))
        {
            payload += $",\"sessionId\":\"{sessionId}\"";
        }
        payload += "}";
        SendRaw($"42[\"gesture:detected\",{payload}]");
    }

    private async void SendRaw(string msg)
    {
        if (ws == null || ws.State != WebSocketState.Open) return;
        try
        {
            var bytes = Encoding.UTF8.GetBytes(msg);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true,
                cts?.Token ?? CancellationToken.None);
        }
        catch (Exception e)
        {
            Debug.LogWarning("[WS] Send error: " + e.Message);
        }
    }

    public bool IsConnected => isConnected;
    public bool HasJoinedSession => hasCompletedHandshake && !string.IsNullOrEmpty(sessionId);

    void OnDestroy()
    {
        Cleanup();
    }

    void OnApplicationQuit()
    {
        Cleanup();
    }

    private void Cleanup()
    {
        isRunning = false;
        CancelInvoke(nameof(Connect));

        cts?.Cancel();
        cts?.Dispose();
        cts = null;

        if (ws != null)
        {
            if (ws.State == WebSocketState.Open)
            {
                try { ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Shutdown", CancellationToken.None); }
                catch { /* shutting down */ }
            }
            ws.Dispose();
            ws = null;
        }

        if (Instance == this) Instance = null;
    }
}
