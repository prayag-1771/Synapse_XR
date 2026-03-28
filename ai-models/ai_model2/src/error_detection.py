import numpy as np

def calculate_angle_error(expert_imu, worker_imu):
    """
    Compare orientation difference between expert and worker.
    """

    expert = np.array(expert_imu)
    worker = np.array(worker_imu)

    error = np.linalg.norm(expert - worker)

    return error


def detect_error(expert_data, worker_data, threshold=0.2):
    """
    Detect if worker deviates from expert.
    """

    expert_imu = [
        expert_data["imu"]["qx"],
        expert_data["imu"]["qy"],
        expert_data["imu"]["qz"],
        expert_data["imu"]["qw"]
    ]

    worker_imu = [
        worker_data["imu"]["qx"],
        worker_data["imu"]["qy"],
        worker_data["imu"]["qz"],
        worker_data["imu"]["qw"]
    ]

    error = calculate_angle_error(expert_imu, worker_imu)

    if error > threshold:
        return {
            "status": "incorrect",
            "error": error,
            "message": "Adjust hand orientation"
        }
    else:
        return {
            "status": "correct",
            "error": error,
            "message": "Good alignment"
        }