using UnityEngine;
using System.Collections.Generic;

/// <summary>
/// Renders one or more tracked hands as volumetric 3D meshes in Unity.
/// Supports dual hands (left/right), auto-creates flesh-toned materials,
/// times out stale hands, and integrates with GestureDetector and Smoothing.
/// </summary>
public class HandVisualizer : MonoBehaviour
{
    [Header("Joint Appearance")]
    public GameObject jointPrefab;
    public Material overrideMaterial;
    public float jointRadius = 0.015f;

    [Header("Bone Appearance")]
    public float boneWidth = 0.018f;
    public int smoothVertices = 8;

    [Header("Palm Mesh")]
    public bool enablePalmMesh = true;
    public float palmThickness = 0.008f;

    [Header("Scale & Timeout")]
    public float worldScale = 5f;
    public float handTimeoutSeconds = 2f;

    // ─── Internal Hand Representation ───────────────────────────────

    private class HandModel
    {
        public Transform root;
        public Transform[] joints = new Transform[21];
        public LineRenderer[] bones;
        public Smoothing[] smoothers = new Smoothing[21];
        public GestureDetector detector;
        public MeshFilter palmMeshFilter;
        public MeshRenderer palmRenderer;
        public float lastUpdateTime;
    }

    private Dictionary<string, HandModel> hands = new Dictionary<string, HandModel>();
    private Queue<HandData> incomingData = new Queue<HandData>();

    // MediaPipe hand skeleton topology
    private static readonly int[][] BONE_CONNECTIONS = {
        // Thumb
        new[]{0,1}, new[]{1,2}, new[]{2,3}, new[]{3,4},
        // Index
        new[]{0,5}, new[]{5,6}, new[]{6,7}, new[]{7,8},
        // Middle
        new[]{0,9}, new[]{9,10}, new[]{10,11}, new[]{11,12},
        // Ring
        new[]{0,13}, new[]{13,14}, new[]{14,15}, new[]{15,16},
        // Pinky
        new[]{0,17}, new[]{17,18}, new[]{18,19}, new[]{19,20},
        // Palm cross-connections
        new[]{5,9}, new[]{9,13}, new[]{13,17}
    };

    // Palm face indices for mesh generation
    private static readonly int[] PALM_INDICES = { 0, 5, 9, 13, 17 };

    private Material fleshMaterialLeft;
    private Material fleshMaterialRight;

    // ─── Lifecycle ──────────────────────────────────────────────────

    void Start()
    {
        WebSocketClient.OnHandDataReceived += OnDataReceived;
        CreateDefaultMaterials();
    }

    void OnDestroy()
    {
        WebSocketClient.OnHandDataReceived -= OnDataReceived;
        foreach (var h in hands.Values)
        {
            if (h.detector != null)
                h.detector.OnGestureRecognized -= OnGesture;
        }
    }

    void OnDataReceived(HandData data)
    {
        lock (incomingData) { incomingData.Enqueue(data); }
    }

    // ─── Materials ──────────────────────────────────────────────────

    private void CreateDefaultMaterials()
    {
        Shader litShader = Shader.Find("Universal Render Pipeline/Lit");
        if (litShader == null) litShader = Shader.Find("Standard"); // Fallback

        fleshMaterialLeft = new Material(litShader);
        fleshMaterialLeft.color = new Color(0.96f, 0.80f, 0.69f, 1f); // Warm peach
        fleshMaterialLeft.SetFloat("_Smoothness", 0.25f);

        fleshMaterialRight = new Material(litShader);
        fleshMaterialRight.color = new Color(0.88f, 0.73f, 0.63f, 1f); // Slightly darker
        fleshMaterialRight.SetFloat("_Smoothness", 0.25f);
    }

    private Material GetMaterial(string handId)
    {
        if (overrideMaterial != null) return overrideMaterial;
        return handId == "left" ? fleshMaterialLeft : fleshMaterialRight;
    }

    // ─── Hand Creation ──────────────────────────────────────────────

    private HandModel CreateHand(string handId)
    {
        var model = new HandModel();
        model.root = new GameObject(handId + "_Hand").transform;
        model.root.SetParent(transform);
        model.bones = new LineRenderer[BONE_CONNECTIONS.Length];
        model.lastUpdateTime = Time.time;

        Material mat = GetMaterial(handId);

        // Gesture detector
        model.detector = model.root.gameObject.AddComponent<GestureDetector>();
        model.detector.OnGestureRecognized += OnGesture;

        // Create joints
        for (int i = 0; i < 21; i++)
        {
            model.smoothers[i] = new Smoothing();

            if (jointPrefab != null)
            {
                model.joints[i] = Instantiate(jointPrefab, model.root).transform;
            }
            else
            {
                var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                // Remove collider to save physics overhead
                var col = sphere.GetComponent<Collider>();
                if (col != null) Destroy(col);

                sphere.transform.SetParent(model.root);

                // Fingertips slightly larger than mid-joints
                bool isTip = (i == 4 || i == 8 || i == 12 || i == 16 || i == 20);
                float radius = isTip ? jointRadius * 1.3f : jointRadius;
                sphere.transform.localScale = Vector3.one * radius * 2f;

                sphere.GetComponent<Renderer>().material = mat;
                model.joints[i] = sphere.transform;
            }
        }

        // Create bones (LineRenderers)
        for (int i = 0; i < BONE_CONNECTIONS.Length; i++)
        {
            var lineObj = new GameObject("Bone_" + i);
            lineObj.transform.SetParent(model.root);
            var lr = lineObj.AddComponent<LineRenderer>();

            lr.material = mat;
            lr.positionCount = 2;
            lr.useWorldSpace = false;

            // Tapered bones: slightly wider at the base
            bool isPalmBone = (BONE_CONNECTIONS[i][0] == 0);
            lr.startWidth = isPalmBone ? boneWidth * 1.4f : boneWidth;
            lr.endWidth = boneWidth;

            // Smooth rounding
            lr.numCapVertices = smoothVertices;
            lr.numCornerVertices = smoothVertices;

            // Shadow casting for realism
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.On;
            lr.receiveShadows = true;

            model.bones[i] = lr;
        }

        // Palm mesh (a filled polygon between the base of each finger)
        if (enablePalmMesh)
        {
            var palmObj = new GameObject("PalmMesh");
            palmObj.transform.SetParent(model.root);
            model.palmMeshFilter = palmObj.AddComponent<MeshFilter>();
            model.palmRenderer = palmObj.AddComponent<MeshRenderer>();
            model.palmRenderer.material = mat;
            model.palmMeshFilter.mesh = CreatePalmMesh();
        }

        return model;
    }

    // ─── Palm Mesh Generation ───────────────────────────────────────

    private Mesh CreatePalmMesh()
    {
        var mesh = new Mesh();
        mesh.name = "PalmMesh";

        // 5 vertices (wrist + 4 finger MCPs) — will be updated each frame
        mesh.vertices = new Vector3[5];
        mesh.normals = new Vector3[] {
            Vector3.forward, Vector3.forward, Vector3.forward,
            Vector3.forward, Vector3.forward
        };

        // Fan triangulation from wrist (index 0)
        mesh.triangles = new int[] {
            0, 1, 2,
            0, 2, 3,
            0, 3, 4,
            // Backface
            0, 2, 1,
            0, 3, 2,
            0, 4, 3
        };

        return mesh;
    }

    private void UpdatePalmMesh(HandModel model)
    {
        if (model.palmMeshFilter == null) return;

        var mesh = model.palmMeshFilter.mesh;
        var verts = new Vector3[5];
        for (int i = 0; i < PALM_INDICES.Length; i++)
        {
            verts[i] = model.joints[PALM_INDICES[i]].localPosition;
        }
        mesh.vertices = verts;
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
    }

    // ─── Gesture Callback ───────────────────────────────────────────

    private void OnGesture(string gesture, float confidence)
    {
        if (gesture == "None") return;

        Debug.Log($"[Gesture] {gesture} ({confidence:P0})");

        #if UNITY_ANDROID || UNITY_IOS
        Handheld.Vibrate();
        #endif

        if (WebSocketClient.Instance != null)
            WebSocketClient.Instance.SendGesture(gesture);
    }

    // ─── Update Loop ────────────────────────────────────────────────

    void Update()
    {
        // Process all queued hand data
        HandData[] batch;
        lock (incomingData)
        {
            if (incomingData.Count == 0) { CheckTimeouts(); return; }
            batch = incomingData.ToArray();
            incomingData.Clear();
        }

        foreach (var data in batch)
        {
            if (data == null || data.landmarks == null || data.landmarks.Length < 21) continue;

            string id = data.hand.ToLower();

            if (!hands.ContainsKey(id))
                hands[id] = CreateHand(id);

            var hand = hands[id];
            hand.lastUpdateTime = Time.time;

            // Update joint positions with Kalman smoothing
            for (int i = 0; i < 21; i++)
            {
                Vector3 raw = new Vector3(
                    (0.5f - data.landmarks[i].x) * worldScale,
                    (0.5f - data.landmarks[i].y) * worldScale,
                    data.landmarks[i].z * worldScale
                );
                hand.joints[i].localPosition = hand.smoothers[i].KalmanSmooth(raw);
            }

            // Update bone line renderers
            for (int i = 0; i < BONE_CONNECTIONS.Length; i++)
            {
                hand.bones[i].SetPosition(0, hand.joints[BONE_CONNECTIONS[i][0]].localPosition);
                hand.bones[i].SetPosition(1, hand.joints[BONE_CONNECTIONS[i][1]].localPosition);
            }

            // Update palm mesh
            if (enablePalmMesh) UpdatePalmMesh(hand);

            // Run gesture detection on smoothed joints
            hand.detector.DetectGestures(hand.joints);
        }

        CheckTimeouts();
    }

    // ─── Timeout Handling ───────────────────────────────────────────

    private void CheckTimeouts()
    {
        var toRemove = new List<string>();
        foreach (var kvp in hands)
        {
            if (Time.time - kvp.Value.lastUpdateTime > handTimeoutSeconds)
                toRemove.Add(kvp.Key);
        }

        foreach (var id in toRemove)
        {
            var hand = hands[id];
            if (hand.detector != null) hand.detector.OnGestureRecognized -= OnGesture;
            if (hand.root != null) Destroy(hand.root.gameObject);
            hands.Remove(id);
            Debug.Log($"[Hand] {id} hand timed out and was removed");
        }
    }
}
