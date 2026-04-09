# Image processing macro example

import numpy as np

# Generate a noisy 2D Gaussian
size = 256
y, x = np.mgrid[0:size, 0:size]
cx, cy = size / 2, size / 2
img = np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 30 ** 2))
img += 0.05 * np.random.rand(size, size)

oid = await proxy.add_image("gaussian", img)
print(f"Created image {oid}")
await proxy.set_current_panel("image")

# Apply an FFT to the new image (image: prefix mirrors DataLab-Web's
# namespaced feature ids; see `await proxy.list_features()`).
result_ids = await proxy.calc("image:fft", sources=[oid])
print(f"FFT result: {result_ids}")
