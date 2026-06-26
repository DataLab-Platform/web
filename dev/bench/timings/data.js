window.BENCHMARK_DATA = {
  "lastUpdate": 1782469468376,
  "repoUrl": "https://github.com/DataLab-Platform/web",
  "entries": {
    "DataLab-Web perf (timings)": [
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
        "date": 1782468351351,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1778.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 80.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 21.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 162.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 156,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 290.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 252.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 173.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 188.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 333.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 335,
            "unit": "ms"
          }
        ]
      },
      {
        "commit": {
          "author": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "committer": {
            "email": "1311787+PierreRaybaut@users.noreply.github.com",
            "name": "Pierre Raybaut",
            "username": "PierreRaybaut"
          },
          "distinct": true,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782469467691,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1894,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 51.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 44,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 233.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 166.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 350.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 259.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 184.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 157.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 337.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 320.8,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}