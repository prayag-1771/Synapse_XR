using UnityEngine;
using System;

/// <summary>
/// Algorithmic gesture detector using joint distance/angle heuristics.
/// Supports: Fist, Thumbs Up, Pointing, Peace, Open Palm.
/// Uses time-based debouncing to prevent flickering between states.
/// Phase 2: Can be augmented with LSTM classifier for learned gestures.
/// </summary>
public class GestureDetector : MonoBehaviour
{
    public event Action<string, float> OnGestureRecognized;

    [Header("Detection Settings")]
    public float debounceTime = 0.3f;
    public float thumbThresholdRatio = 1.15f; // Thumb tip must be 15% further than IP joint

    private string currentGesture = "None";
    private string candidateGesture = "None";
    private float candidateTimer = 0f;

    /// <summary>
    /// Analyze the 21-joint hand skeleton and detect gestures.
    /// Call this every frame with the smoothed joint transforms.
    /// </summary>
    public void DetectGestures(Transform[] joints)
    {
        if (joints == null || joints.Length < 21) return;

        // Check extension state of each finger
        bool thumbExtended = IsThumbExtended(joints);
        bool indexExtended = IsFingerExtended(joints, 8, 6, 5);
        bool middleExtended = IsFingerExtended(joints, 12, 10, 9);
        bool ringExtended = IsFingerExtended(joints, 16, 14, 13);
        bool pinkyExtended = IsFingerExtended(joints, 20, 18, 17);

        string detected = ClassifyGesture(thumbExtended, indexExtended, middleExtended, ringExtended, pinkyExtended);

        // Debounce: require the same gesture for debounceTime before locking it in
        if (detected == candidateGesture)
        {
            candidateTimer += Time.deltaTime;
            if (candidateTimer >= debounceTime && currentGesture != detected)
            {
                currentGesture = detected;
                float confidence = CalculateConfidence(joints, detected);
                OnGestureRecognized?.Invoke(currentGesture, confidence);
            }
        }
        else
        {
            candidateGesture = detected;
            candidateTimer = 0f;
        }
    }

    /// <summary>
    /// Classify gesture from the finger extension booleans.
    /// </summary>
    private string ClassifyGesture(bool thumb, bool index, bool middle, bool ring, bool pinky)
    {
        int extendedCount = (thumb ? 1 : 0) + (index ? 1 : 0) + (middle ? 1 : 0) + (ring ? 1 : 0) + (pinky ? 1 : 0);

        // Open Palm: all 5 fingers extended
        if (thumb && index && middle && ring && pinky)
            return "Open Palm";

        // Fist: no fingers extended
        if (extendedCount == 0)
            return "Fist";

        // Thumbs Up: only thumb extended, all others closed
        if (thumb && !index && !middle && !ring && !pinky)
            return "Thumbs Up";

        // Pointing: only index finger extended
        if (!thumb && index && !middle && !ring && !pinky)
            return "Pointing";

        // Peace/Victory: index + middle extended, rest closed
        if (!thumb && index && middle && !ring && !pinky)
            return "Peace";

        return "None";
    }

    /// <summary>
    /// For fingers (not thumb): compare tip-to-MCP distance vs PIP-to-MCP distance.
    /// Extended if the tip is further from the MCP base than the PIP joint is.
    /// </summary>
    private bool IsFingerExtended(Transform[] joints, int tipIdx, int pipIdx, int mcpIdx)
    {
        float tipDist = Vector3.Distance(joints[tipIdx].position, joints[mcpIdx].position);
        float pipDist = Vector3.Distance(joints[pipIdx].position, joints[mcpIdx].position);
        return tipDist > pipDist;
    }

    /// <summary>
    /// Thumb uses a different heuristic: compare thumb tip distance to pinky MCP
    /// vs thumb IP distance to pinky MCP. A ratio-based check avoids scale issues.
    /// </summary>
    private bool IsThumbExtended(Transform[] joints)
    {
        float thumbTipDist = Vector3.Distance(joints[4].position, joints[17].position);
        float thumbIpDist = Vector3.Distance(joints[3].position, joints[17].position);

        // Ratio-based: works regardless of hand scale or distance from camera
        return thumbTipDist > (thumbIpDist * thumbThresholdRatio);
    }

    /// <summary>
    /// Rough confidence based on how "clean" the gesture shape is.
    /// </summary>
    private float CalculateConfidence(Transform[] joints, string gesture)
    {
        // For now return high confidence for recognized gestures
        // Phase 2: LSTM model will provide real confidence scores
        if (gesture == "None") return 0f;
        return 0.85f;
    }

    /// <summary>
    /// Get the currently locked-in gesture name.
    /// </summary>
    public string GetCurrentGesture()
    {
        return currentGesture;
    }
}
