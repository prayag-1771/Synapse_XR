using UnityEngine;

public class HandVisualizer : MonoBehaviour
{
    public GameObject jointPrefab;
    public Material lineMaterial;
    
    private Transform[] joints = new Transform[21];
    private LineRenderer[] lines;
    private Smoothing[] smoothers = new Smoothing[21];

    private bool dataUpdated = false;
    private HandData latestData;
    private GestureDetector detector;

    // Standard hand skeleton connections
    private readonly int[][] connections = new int[][]
    {
        new int[] {0, 1}, new int[] {1, 2}, new int[] {2, 3}, new int[] {3, 4},
        new int[] {0, 5}, new int[] {5, 6}, new int[] {6, 7}, new int[] {7, 8},
        new int[] {0, 9}, new int[] {9, 10}, new int[] {10, 11}, new int[] {11, 12},
        new int[] {0, 13}, new int[] {13, 14}, new int[] {14, 15}, new int[] {15, 16},
        new int[] {0, 17}, new int[] {17, 18}, new int[] {18, 19}, new int[] {19, 20},
        new int[] {5, 9}, new int[] {9, 13}, new int[] {13, 17}
    };

    void Start()
    {
        detector = gameObject.AddComponent<GestureDetector>();
        detector.OnGestureRecognized += HandleGestureRecognized;

        lines = new LineRenderer[connections.Length];

        for (int i = 0; i < 21; i++)
        {
            smoothers[i] = new Smoothing();
            
            // Create a default sphere if no prefab provided
            if (jointPrefab != null)
            {
                joints[i] = Instantiate(jointPrefab, transform).transform;
            }
            else
            {
                GameObject sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                sphere.transform.SetParent(transform);
                sphere.transform.localScale = Vector3.one * 0.02f; // 2cm diameter
                joints[i] = sphere.transform;
            }
        }

        for (int i = 0; i < connections.Length; i++)
        {
            GameObject lineObj = new GameObject("Line_" + i);
            lineObj.transform.SetParent(transform);
            LineRenderer lr = lineObj.AddComponent<LineRenderer>();
            if (lineMaterial != null) lr.material = lineMaterial;
            lr.startWidth = 0.005f;
            lr.endWidth = 0.005f;
            lr.positionCount = 2;
            lines[i] = lr;
        }

        WebSocketClient.OnHandDataReceived += HandleHandData;
    }

    void OnDestroy()
    {
        WebSocketClient.OnHandDataReceived -= HandleHandData;
        if (detector != null)
            detector.OnGestureRecognized -= HandleGestureRecognized;
    }

    void HandleGestureRecognized(string gesture)
    {
        if (gesture != "None")
        {
            Debug.Log("Gesture Locked: " + gesture);
            
            // Haptic Feedback for device
            #if UNITY_ANDROID || UNITY_IOS
            Handheld.Vibrate(); 
            #endif

            // Notify backend
            if (WebSocketClient.Instance != null)
            {
                WebSocketClient.Instance.SendGesture(gesture);
            }
        }
    }

    void HandleHandData(HandData data)
    {
        latestData = data;
        dataUpdated = true;
    }

    void Update()
    {
        if (dataUpdated && latestData != null && latestData.landmarks != null && latestData.landmarks.Length >= 21)
        {
            for (int i = 0; i < 21; i++)
            {
                // Basic mapping to Unity's coordinate system scale
                // MediaPipe gives normalized X and Y coordinates (between 0.0 and 1.0)
                // We're scaling it up to World Space (e.g. 10 meters width) and centering it.
                Vector3 rawPos = new Vector3(
                    (0.5f - latestData.landmarks[i].x) * 10f, // invert X for mirror
                    (0.5f - latestData.landmarks[i].y) * 10f, // invert Y
                    latestData.landmarks[i].z * 10f
                );

                // Phase 1 Smoothing: Apply Kalman Filter
                Vector3 smoothedPos = smoothers[i].KalmanSmooth(rawPos);

                joints[i].localPosition = smoothedPos;
            }

            for (int i = 0; i < connections.Length; i++)
            {
                int startIdx = connections[i][0];
                int endIdx = connections[i][1];

                lines[i].SetPosition(0, joints[startIdx].position);
                lines[i].SetPosition(1, joints[endIdx].position);
            }

            // Analyze gestures over smoothed positions
            if (detector != null)
                detector.DetectGestures(joints);

            dataUpdated = false;
        }
    }
}
