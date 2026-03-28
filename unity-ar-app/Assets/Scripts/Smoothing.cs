using UnityEngine;

/// <summary>
/// Per-joint smoothing filter with independent per-axis Kalman state.
/// Z axis uses higher noise values since MediaPipe depth estimation is noisiest.
/// Phase 2: This class will be swapped with LSTM inference once Sudarsan's model is ready.
/// </summary>
public class Smoothing
{
    // Process noise per axis (how much we expect the hand to move between frames)
    private readonly float qX, qY, qZ;
    // Measurement noise per axis (how noisy the sensor reading is)
    private readonly float rX, rY, rZ;

    // Per-axis estimation error covariance
    private float pX = 1f, pY = 1f, pZ = 1f;
    // Per-axis Kalman gain (computed each frame)
    private float kX, kY, kZ;

    private Vector3 estimate;
    private bool initialized = false;

    // Velocity tracking for predictive smoothing
    private Vector3 lastMeasurement;
    private Vector3 velocity;
    private bool hasVelocity = false;

    /// <summary>
    /// Create a Kalman smoother with per-axis noise tuning.
    /// Defaults are optimized for MediaPipe hand landmarks.
    /// </summary>
    public Smoothing(
        float processNoiseXY = 0.001f, float processNoiseZ = 0.002f,
        float measureNoiseXY = 0.01f, float measureNoiseZ = 0.03f)
    {
        qX = processNoiseXY; qY = processNoiseXY; qZ = processNoiseZ;
        rX = measureNoiseXY; rY = measureNoiseXY; rZ = measureNoiseZ;
    }

    /// <summary>
    /// Quick exponential moving average blend (useful when Kalman is overkill).
    /// </summary>
    public static Vector3 EMASmooth(Vector3 prev, Vector3 current, float alpha = 0.3f)
    {
        return alpha * current + (1f - alpha) * prev;
    }

    /// <summary>
    /// Run one Kalman filter iteration per axis with velocity-assisted prediction.
    /// </summary>
    public Vector3 KalmanSmooth(Vector3 measurement)
    {
        if (!initialized)
        {
            estimate = measurement;
            lastMeasurement = measurement;
            initialized = true;
            return estimate;
        }

        // Compute velocity for predictive step
        if (hasVelocity)
        {
            velocity = EMASmooth(velocity, measurement - lastMeasurement, 0.5f);
        }
        else
        {
            velocity = measurement - lastMeasurement;
            hasVelocity = true;
        }
        lastMeasurement = measurement;

        // Predict step: use velocity to predict where the joint should be
        Vector3 predicted = estimate + velocity;

        // Per-axis update
        pX += qX; kX = pX / (pX + rX); pX *= (1f - kX);
        pY += qY; kY = pY / (pY + rY); pY *= (1f - kY);
        pZ += qZ; kZ = pZ / (pZ + rZ); pZ *= (1f - kZ);

        estimate.x = predicted.x + kX * (measurement.x - predicted.x);
        estimate.y = predicted.y + kY * (measurement.y - predicted.y);
        estimate.z = predicted.z + kZ * (measurement.z - predicted.z);

        return estimate;
    }

    /// <summary>
    /// Reset filter state (e.g. when hand is lost and re-detected).
    /// </summary>
    public void Reset()
    {
        initialized = false;
        hasVelocity = false;
        pX = pY = pZ = 1f;
        velocity = Vector3.zero;
    }
}
