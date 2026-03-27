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
    public Landmark[] landmarks;
    public long timestamp;
}

public class WebSocketClient : MonoBehaviour
{
    public static WebSocketClient Instance { get; private set; }

    public string serverUrl = "ws://localhost:5000/socket.io/?EIO=4&transport=websocket";
    public static event Action<HandData> OnHandDataReceived;
    public static event Action<bool> OnConnectionChanged;

    [Header("Reconnection")]
    public float reconnectDelay = 2f;
    public float maxReconnectDelay = 30f;
    public int maxReconnectAttempts = 0; // 0 = unlimited

    private ClientWebSocket ws;
    private readonly Queue<string> messageQueue = new Queue<string>();
    private CancellationTokenSource cts;
    private bool isRunning;
    private bool isConnected;
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

    private async void Connect()
    {
        cts?.Cancel();
        cts?.Dispose();
        cts = new CancellationTokenSource();
        var token = cts.Token;

        ws?.Dispose();
        ws = new ClientWebSocket();
        isRunning = true;

        try
        {
            await ws.ConnectAsync(new Uri(serverUrl), token);
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
            // Open -> Send Socket.IO Connect
            SendRaw("40");
            return;
        }

        if (msg.StartsWith("40"))
        {
            // Socket.IO connected acknowledgement
            Debug.Log("[WS] Socket.IO handshake complete");
            return;
        }

        // 42["event", { payload }]
        if (msg.StartsWith("42"))
        {
            ParseSocketIOEvent(msg);
        }
    }

    private void ParseSocketIOEvent(string msg)
    {
        // Format: 42["eventName",{json}]
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
        }
    }

    public void SendGesture(string gestureName)
    {
        string payload = $"{{\"gesture\":\"{gestureName}\",\"confidence\":1.0}}";
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
