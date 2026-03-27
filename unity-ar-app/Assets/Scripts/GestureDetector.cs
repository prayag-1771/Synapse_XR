using UnityEngine;
using System;

public class GestureDetector : MonoBehaviour
{
    public event Action<string> OnGestureRecognized;
    
    private string currentGesture = "None";
    private string lastDetectedGesture = "None";
    private float gestureTimer = 0f;
    
    // 300ms to lock in a gesture
    public float debounceTime = 0.3f; 

    public void DetectGestures(Transform[] joints)
    {
        if (joints == null || joints.Length < 21) return;

        bool indexExtended = IsExtended(joints, 8, 6, 0);
        bool middleExtended = IsExtended(joints, 12, 10, 0);
        bool ringExtended = IsExtended(joints, 16, 14, 0);
        bool pinkyExtended = IsExtended(joints, 20, 18, 0);
        
        // Thumb extended: thumb tip (4) is further from pinky base (17) than thumb IP (3)
        // Adjust threshold multiplier based on testing the hand size
        float thumbTipDist = Vector3.Distance(joints[4].position, joints[17].position);
        float thumbIpDist = Vector3.Distance(joints[3].position, joints[17].position);
        
        bool thumbExtended = thumbTipDist > (thumbIpDist + 0.05f * 10f); // 10f is scale factor from visualizer

        string detected = "None";

        // Logic check:
        // Fist: All fingers closed
        // Pointing: Only Index extended
        // Thumbs Up: Only Thumb extended
        
        if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended)
        {
            if (thumbExtended)
                detected = "Thumbs Up";
            else
                detected = "Fist";
        }
        else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended)
        {
            if (!thumbExtended) // Make sure thumb isn't sticking out too much like a gun
                detected = "Pointing"; 
        }

        if (detected == lastDetectedGesture)
        {
            gestureTimer += Time.deltaTime;
            if (gestureTimer >= debounceTime && currentGesture != detected)
            {
                currentGesture = detected;
                OnGestureRecognized?.Invoke(currentGesture);
            }
        }
        else
        {
            lastDetectedGesture = detected;
            gestureTimer = 0f;
        }
    }

    private bool IsExtended(Transform[] joints, int tipIdx, int pipIdx, int wristIdx)
    {
        float tipDist = Vector3.Distance(joints[tipIdx].position, joints[wristIdx].position);
        float pipDist = Vector3.Distance(joints[pipIdx].position, joints[wristIdx].position);
        return tipDist > pipDist;
    }
}
