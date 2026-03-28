from src.inference import run_inference


expert_data = {
    "imu": {"qx": 0.12, "qy": 0.45, "qz": 0.33, "qw": 0.82}
}

worker_data = {
    "imu": {"qx": 0.20, "qy": 0.40, "qz": 0.30, "qw": 0.75}
}


output = run_inference(expert_data, worker_data)

print("AI OUTPUT (Backend Ready):")
print(output)