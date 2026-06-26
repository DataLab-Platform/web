window.BENCHMARK_DATA = {
  "lastUpdate": 1782489010358,
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
          "distinct": false,
          "id": "d13eb8a321471a469b0913bb86ab31729abcf24d",
          "message": "fix: align View action locale types with SupportedLocale\n\ntsc -b failed because buildViewActions typed the locale code as plain\nstring, rejecting the i18n SupportedLocale values and the readonly\navailableLocales array passed from App.\n\nAssisted-by: Claude Opus 4.8",
          "timestamp": "2026-06-26T11:46:40+02:00",
          "tree_id": "fe39f3917de53393e64010e8e61ce27dbeacc946",
          "url": "https://github.com/DataLab-Platform/web/commit/d13eb8a321471a469b0913bb86ab31729abcf24d"
        },
        "date": 1782473107931,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1395.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 90.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 15.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 168.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 149.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 246.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 172.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 185.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 159.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 246.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 234.1,
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
          "id": "5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb",
          "message": "feat: add isDiskStorageSupported instance method to RuntimeApi and update benchmarks",
          "timestamp": "2026-06-26T17:47:02+02:00",
          "tree_id": "f7bd2772c258e9338b2e05e27a90df5f6b36094d",
          "url": "https://github.com/DataLab-Platform/web/commit/5cfdfc3f9e552c178fbe7f3474c97e48bd45e8bb"
        },
        "date": 1782489009982,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1580,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 74.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 22.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 159.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 144.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 319.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 236.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 184.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 188.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 298.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 307,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}