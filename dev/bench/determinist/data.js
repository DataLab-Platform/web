window.BENCHMARK_DATA = {
  "lastUpdate": 1782468349618,
  "repoUrl": "https://github.com/DataLab-Platform/web",
  "entries": {
    "DataLab-Web perf (deterministic)": [
      {
        "commit": {
          "author": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "committer": {
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut",
            "email": "1311787+PierreRaybaut@users.noreply.github.com"
          },
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T09:46:40Z",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782468348834,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · payload (4 imgs)",
            "value": 33.21,
            "unit": "MB"
          },
          {
            "name": "opfs_storage · disk Δheap [1024² ×16 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 130.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk Δheap [2048² ×8 float64]",
            "value": 0,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 74.3,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [1024² ×16 float64]",
            "value": 35.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · async Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          },
          {
            "name": "opfs_worker · sync Δheap [2048² ×8 float64]",
            "value": 94.6,
            "unit": "MiB"
          }
        ]
      }
    ]
  }
}