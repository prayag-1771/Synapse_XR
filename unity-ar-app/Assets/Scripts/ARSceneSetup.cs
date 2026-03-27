using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.InputSystem.XR;
using Unity.XR.CoreUtils;

/// <summary>
/// Programmatically creates the AR session hierarchy at runtime.
/// If ARCore is unavailable (e.g. Unity Editor on PC), falls back to a regular camera.
/// Attach this script to an empty GameObject in your scene.
/// </summary>
public class ARSceneSetup : MonoBehaviour
{
    [Header("References")]
    public HandVisualizer handVisualizer;

    [Header("Fallback Settings")]
    public Color fallbackBackgroundColor = new Color(0.1f, 0.1f, 0.15f);

    private bool isARMode = false;

    void Awake()
    {
        // Try to set up AR; fall back to regular camera if unavailable
        if (IsARSupported())
        {
            SetupARScene();
        }
        else
        {
            SetupFallbackScene();
        }
    }

    private bool IsARSupported()
    {
        #if UNITY_EDITOR
        // Always use fallback in Editor since there's no real AR device
        Debug.Log("[AR] Running in Editor — using fallback camera mode");
        return false;
        #elif UNITY_ANDROID || UNITY_IOS
        return true;
        #else
        return false;
        #endif
    }

    private void SetupARScene()
    {
        isARMode = true;
        Debug.Log("[AR] Setting up AR Foundation scene");

        // 1. Create AR Session (manages the ARCore/ARKit lifecycle)
        GameObject arSessionObj = new GameObject("AR Session");
        arSessionObj.AddComponent<ARSession>();
        arSessionObj.AddComponent<ARInputManager>();

        // 2. Create XR Origin (replaces the old AR Session Origin in AR Foundation 5+)
        GameObject xrOriginObj = new GameObject("XR Origin");
        var xrOrigin = xrOriginObj.AddComponent<Unity.XR.CoreUtils.XROrigin>();

        // 3. Create AR Camera as child of XR Origin
        GameObject arCameraObj = new GameObject("AR Camera");
        arCameraObj.transform.SetParent(xrOriginObj.transform);
        arCameraObj.tag = "MainCamera";

        Camera arCamera = arCameraObj.AddComponent<Camera>();
        arCamera.clearFlags = CameraClearFlags.SolidColor;
        arCamera.backgroundColor = Color.black;
        arCamera.nearClipPlane = 0.1f;
        arCamera.farClipPlane = 50f;

        // Add AR components to the camera
        arCameraObj.AddComponent<ARCameraManager>();
        arCameraObj.AddComponent<ARCameraBackground>();
        arCameraObj.AddComponent<TrackedPoseDriver>();

        // Set the camera on the XR Origin
        xrOrigin.Camera = arCamera;

        // 4. Disable the old Main Camera if it exists
        DisableOldMainCamera(arCameraObj);

        // 5. Parent our hand visualizer under XR Origin so hands are in AR space
        SetupHandVisualizer(xrOriginObj.transform);

        Debug.Log("[AR] AR scene ready — hands will overlay on real-world camera feed");
    }

    private void SetupFallbackScene()
    {
        isARMode = false;
        Debug.Log("[AR] Fallback mode — using standard 3D camera");

        // Use the existing Main Camera but adjust it
        Camera mainCam = Camera.main;
        if (mainCam != null)
        {
            mainCam.clearFlags = CameraClearFlags.SolidColor;
            mainCam.backgroundColor = fallbackBackgroundColor;
            mainCam.transform.position = new Vector3(0, 0, -3f);
            mainCam.transform.LookAt(Vector3.zero);
        }

        // Parent hand visualizer at origin
        SetupHandVisualizer(transform);

        Debug.Log("[AR] Fallback scene ready — hands render in 3D view");
    }

    private void SetupHandVisualizer(Transform parent)
    {
        if (handVisualizer != null)
        {
            handVisualizer.transform.SetParent(parent);
            handVisualizer.transform.localPosition = Vector3.zero;
        }
    }

    private void DisableOldMainCamera(GameObject newCameraObj)
    {
        Camera[] allCameras = FindObjectsByType<Camera>(FindObjectsSortMode.None);
        foreach (Camera cam in allCameras)
        {
            if (cam.gameObject != newCameraObj)
            {
                cam.gameObject.SetActive(false);
                Debug.Log($"[AR] Disabled old camera: {cam.gameObject.name}");
            }
        }
    }

    /// <summary>
    /// Returns true if the app is currently in AR passthrough mode.
    /// </summary>
    public bool IsInARMode() => isARMode;
}
