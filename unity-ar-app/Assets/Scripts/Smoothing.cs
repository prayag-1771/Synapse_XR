using UnityEngine;

public class Smoothing
{
    // Per-axis Kalman state — X/Y/Z have different noise profiles (Z is noisiest from MediaPipe)
    private readonly float[] q = { 0.001f, 0.001f, 0.002f }; // process noise per axis
    private readonly float[] r = { 0.01f,  0.01f,  0.03f };  // measurement noise per axis (Z higher)
    private float[] p = { 1f, 1f, 1f };                       // estimation error per axis
    private float[] k = new float[3];                          // kalman gain per axis
    private Vector3 estimate;
    private bool initialized = false;

    // Optional EMA for quick blending when Kalman is overkill
    public static Vector3 EMASmooth(Vector3 prev, Vector3 current, float alpha = 0.3f)
    {
        return alpha * current + (1f - alpha) * prev;
    }

    public Vector3 KalmanSmooth(Vector3 measurement)
    {
        if (!initialized)
        {
            estimate = measurement;
            initialized = true;
            return estimate;
        }

        Vector3 result;

        // Per-axis predict + update
        for (int i = 0; i < 3; i++)
        {
            p[i] += q[i];
            k[i] = p[i] / (p[i] + r[i]);
            p[i] *= (1f - k[i]);
        }

        result.x = estimate.x + k[0] * (measurement.x - estimate.x);
        result.y = estimate.y + k[1] * (measurement.y - estimate.y);
        result.z = estimate.z + k[2] * (measurement.z - estimate.z);

        estimate = result;
        return estimate;
    }

    public void Reset()
    {
        initialized = false;
        p = new float[] { 1f, 1f, 1f };
    }
}
