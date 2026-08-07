window.BENCHMARK_DATA = {
  "lastUpdate": 1786109492014,
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
          "id": "6206853b532a1840d95602e4595e2327cc4ac281",
          "message": "feat: add theme option for demo GIF recording and update tests for theme handling",
          "timestamp": "2026-07-01T19:01:11+02:00",
          "tree_id": "5b0facc43bfa27aeaf7d6c1812cc3e313582e756",
          "url": "https://github.com/DataLab-Platform/web/commit/6206853b532a1840d95602e4595e2327cc4ac281"
        },
        "date": 1782925476484,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1729.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 90.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 15.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 183.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 151.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 258.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 272.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 180.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 179.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 306.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 290.9,
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
          "id": "c98dcc027f68a1aa19af311c20abd28dd0070e18",
          "message": "fix: keep command palette search results relevant for short queries\n\nFixes #8",
          "timestamp": "2026-07-08T19:05:30+02:00",
          "tree_id": "16a7a401d06607ee5bb0fcbad459cff8675f1958",
          "url": "https://github.com/DataLab-Platform/web/commit/c98dcc027f68a1aa19af311c20abd28dd0070e18"
        },
        "date": 1783530548001,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1563.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 47,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 26.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 230.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 213.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 309.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 289.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 251.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 250.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 382.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 380.2,
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
          "id": "493884fa0b61823b5d39cebcfb597dab4d883cc3",
          "message": "fix: clarify file destination when saving or exporting\n\nPrefer the native \"Save as…\" picker (Chromium) for every save/export\naction, with a non-modal toast confirming the destination when\nbrowsers fall back to a plain download; warn before \"Save to\ndirectory\" silently falls back the same way.\n\nFixes #7",
          "timestamp": "2026-07-08T19:12:34+02:00",
          "tree_id": "e544117fd9bf2044a00235f89740aac10e0ccf96",
          "url": "https://github.com/DataLab-Platform/web/commit/493884fa0b61823b5d39cebcfb597dab4d883cc3"
        },
        "date": 1783530967697,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1744.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 74.8,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 14,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 198.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 189.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 262.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 225,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 248.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 226.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 357.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 312.2,
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
          "id": "510626ea2db738605275d22921c7978b3f4b2586",
          "message": "fix: install tifffile so TIFF images can be saved and opened",
          "timestamp": "2026-07-08T19:37:40+02:00",
          "tree_id": "499fe11e59a91c283c06217b0763b5d9213ab76a",
          "url": "https://github.com/DataLab-Platform/web/commit/510626ea2db738605275d22921c7978b3f4b2586"
        },
        "date": 1783532453835,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1886.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 81.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 43.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 147.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 159.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 317.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 236.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 194.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 173.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 305.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 344,
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
          "id": "973e154661e0bff12bda41632816b906e31a335f",
          "message": "chore(perf): track ram Δheap as trend-only, not a determinist gate\n\nRAM-mode peak heap growth holds the full working set and is\nallocator-dependent, so single-sample swings trigger false regressions.\nKeep disk Δheap as the deterministic guard.",
          "timestamp": "2026-07-09T11:05:09+02:00",
          "tree_id": "7f6bafeabdab75dcb31f215e9e28de51a02fc773",
          "url": "https://github.com/DataLab-Platform/web/commit/973e154661e0bff12bda41632816b906e31a335f"
        },
        "date": 1783588718005,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1771.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 93.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 196.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 185.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 272.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 196.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 224,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 206.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 339.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 309.9,
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
          "id": "5be99ea07c1e42d18a29e68adf6a90cd88ce7331",
          "message": "fix: stringify HDF5 reference attributes in the h5 browser\n\nFixes #9",
          "timestamp": "2026-07-15T10:06:10+02:00",
          "tree_id": "776831a055c37ae9550fcd8cd8d417eed1aa6b08",
          "url": "https://github.com/DataLab-Platform/web/commit/5be99ea07c1e42d18a29e68adf6a90cd88ce7331"
        },
        "date": 1784102965272,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1771.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 80.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 18.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 179.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 137.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 270.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 175.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 180.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 174.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 314.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 320.2,
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
          "id": "7495830b900a531c4bc19f3c3e99424abacc7a5a",
          "message": "update changelog",
          "timestamp": "2026-07-15T10:46:28+02:00",
          "tree_id": "fabc1128ea257b4094ba4e9c78d341de24b3684c",
          "url": "https://github.com/DataLab-Platform/web/commit/7495830b900a531c4bc19f3c3e99424abacc7a5a"
        },
        "date": 1784105388796,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1486.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 81.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 23.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 193.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 158.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 254.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 235.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 166.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 190.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 303.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 367.4,
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
          "id": "71eed641280b97d8886af60bf7590b0905256a00",
          "message": "feat(image): default to outlier-eliminated contrast (match desktop)\n\nImages now open with the central 98% of the histogram mass, mirroring\ndesktop's ima_eliminate_outliers (2%) instead of raw min/max, which\ncould wash out contrast on a few extreme pixels. Auto button resets to\nthe same range.",
          "timestamp": "2026-07-15T14:21:30+02:00",
          "tree_id": "455cd23d190cd617305224e2a4fe68e6b1d18bf4",
          "url": "https://github.com/DataLab-Platform/web/commit/71eed641280b97d8886af60bf7590b0905256a00"
        },
        "date": 1784118291699,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1957.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 187.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 21.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 201.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 163.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 306,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 204.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 153.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 186.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 279,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 329,
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
          "id": "fa72c58e644fe752637510846b30d5c16438ebd8",
          "message": "feat(demo): enhance GIF generation with lossless frame capture and quality options",
          "timestamp": "2026-07-18T11:09:40+02:00",
          "tree_id": "4cde73033333448da8b3020e85c2f2f254910df6",
          "url": "https://github.com/DataLab-Platform/web/commit/fa72c58e644fe752637510846b30d5c16438ebd8"
        },
        "date": 1784365984881,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1690,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 198.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 29.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 189.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 118.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 295.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 245.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 227.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 212.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 341.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 346.4,
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
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366309693,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1739.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 180,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 33.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 160.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 147.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 281.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 232,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 174.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 155.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 314.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 306.4,
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
          "id": "31cf3779e4d4bcc4956b00aedae4d7f6262b09f9",
          "message": "v0.6.3",
          "timestamp": "2026-07-18T11:15:05+02:00",
          "tree_id": "4aab9fb2756ea450d019b9dc688335cf5814632b",
          "url": "https://github.com/DataLab-Platform/web/commit/31cf3779e4d4bcc4956b00aedae4d7f6262b09f9"
        },
        "date": 1784366325838,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 1867.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 124.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · plotly draw",
            "value": 31,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 156.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 187.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 157.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 163.4,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 261.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 187.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 194.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 187.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 356.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 322.9,
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
          "id": "15720f092e23593256e1b5cd5968fed6c7153536",
          "message": "perf(startup): defer heavy runtime and plotting bundles\n\nLazy-load Plotly views and prewarm primary plots during Pyodide startup.\nKeep the main runtime, Python payloads, and CodeMirror out of worker startup.\nShare Plotly loading and extract lightweight OPFS capability detection.\nEnforce preload invariants and a 375 KiB gzip initial-JS budget at build time.",
          "timestamp": "2026-08-02T19:53:58+02:00",
          "tree_id": "6598aac9f33feb409071bcd0ea083b747df2d3a2",
          "url": "https://github.com/DataLab-Platform/web/commit/15720f092e23593256e1b5cd5968fed6c7153536"
        },
        "date": 1785696183917,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 281.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 18.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 154,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 265.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 16.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 120.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [10000 pts]",
            "value": 19.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 114,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 41.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 330.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 274.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 153.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [100000 pts]",
            "value": 5.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 78,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 51.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 408.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 344.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 134.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [500000 pts]",
            "value": 12.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 98,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 29,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 286.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 214.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 81.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [1000000 pts]",
            "value": 18.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 158,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 28.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 275.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 275.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 204.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 171.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.9,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 288.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 257.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 198,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 195.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 329.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 305.3,
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
          "id": "257b492c4d5dc1946319d5daabf404a21483b45b",
          "message": "fix(interactive-fit): enhance fit type handling and metadata validation",
          "timestamp": "2026-08-03T07:16:53+02:00",
          "tree_id": "1a77821349bcb71233fbf61fcc16d1b4834e8cca",
          "url": "https://github.com/DataLab-Platform/web/commit/257b492c4d5dc1946319d5daabf404a21483b45b"
        },
        "date": 1785734404179,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 245.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 12.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 63.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 231.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 14.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 99.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [10000 pts]",
            "value": 2.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 16.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 208.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 213.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 103.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [100000 pts]",
            "value": 3.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 73,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 40.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 396.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 282.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 125.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [500000 pts]",
            "value": 12,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 124,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 29,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 247.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 257.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 90.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [1000000 pts]",
            "value": 10.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 89,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 18.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 227.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 206.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 190,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 156.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 198.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 252.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 182.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 162.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 258.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 221.1,
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
          "id": "a24827dd60a2aca9d5c0a856f631a60ae47895c5",
          "message": "fix: restore faithful LOD rendering and import panel routing\n\nKeep the current spatial image at full resolution while bounding previews.\nResync signal LOD after Plotly resizes and stabilize related E2E checks.\nRoute imported objects to their matching panel before selecting them.",
          "timestamp": "2026-08-03T08:43:54+02:00",
          "tree_id": "f0597019682f6c1fe0c35ca4ad6be1ef419425b4",
          "url": "https://github.com/DataLab-Platform/web/commit/a24827dd60a2aca9d5c0a856f631a60ae47895c5"
        },
        "date": 1785739690547,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 233.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 16.8,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 85.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 213.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 20.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 104.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [10000 pts]",
            "value": 11.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 89,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 22.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 290.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 254.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 202.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [100000 pts]",
            "value": 3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 62,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 23.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 316.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 382.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 226.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [500000 pts]",
            "value": 16,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 92,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 19.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 394.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 329.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 335,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [1000000 pts]",
            "value": 15.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 113,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 38.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 271.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 292,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 204.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 176,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.9,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 271.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 234.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 199.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 185.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 347.4,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 365.3,
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
          "id": "12440460f065ed46fc5f7be796d1b8497d377231",
          "message": "fix(signal-plot): restore large-signal rendering performance\n\nPreserve Plotly's historical revision for single-signal views to avoid full\ntrace reconciliation. This reduces 1M-point selection from ~360 ms to ~80 ms\nwhile retaining the new revision semantics for multi-signal layouts.",
          "timestamp": "2026-08-03T11:34:27+02:00",
          "tree_id": "298ef88abc0607b21a96f9e4fa72d76895019f17",
          "url": "https://github.com/DataLab-Platform/web/commit/12440460f065ed46fc5f7be796d1b8497d377231"
        },
        "date": 1785749887050,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 283.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 10.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 66.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 262.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 20.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 22.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [10000 pts]",
            "value": 33.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 29.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 326.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 301.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 86.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [100000 pts]",
            "value": 9.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 123,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 43.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 337,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 302,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 48.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [500000 pts]",
            "value": 5.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 78,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 13.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 281.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 218.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 63,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch [1000000 pts]",
            "value": 12.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 101,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 47.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 331,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 218.5,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 208.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 183.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 265.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 301.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 198.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 195,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 277.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 230.5,
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
          "id": "8ec94c0933aa13d876db4c3a9fb1aff7be3b1440",
          "message": "test(perf): stabilize signal fetch benchmarks\n\nWarm up each fetch and report the median of five measured transfers.\nKeep all samples in raw artifacts, but track only stable 500k and 1M\ntimings under a renamed series to prevent false performance alerts.",
          "timestamp": "2026-08-03T11:54:46+02:00",
          "tree_id": "bceb61ca928f9e6c80b13ac8ef92f64286598900",
          "url": "https://github.com/DataLab-Platform/web/commit/8ec94c0933aa13d876db4c3a9fb1aff7be3b1440"
        },
        "date": 1785751082577,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 207.8,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 21,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 72.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 194.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 13.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 68.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 22.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 250.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 231.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 57.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 29.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 334.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 394.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 67.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 15,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 113,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 20.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 238.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 226.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 54.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 20.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 103,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 36.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 251.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 278.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 167,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 148.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 235.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 302,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 146.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 159,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 274.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 259.1,
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
          "id": "25854736dac0768b05ae67f4f92d196e3229a957",
          "message": "ci(perf): stop noisy timing alerts\n\nKeep wall-clock benchmarks in history and workflow summaries, but stop\nposting alerts for relative fluctuations on shared runners. Deterministic\nmemory and payload metrics remain actionable regression guards.",
          "timestamp": "2026-08-03T12:09:19+02:00",
          "tree_id": "ef2f6cae583d800ef30910eaabe5b4980ec6c13c",
          "url": "https://github.com/DataLab-Platform/web/commit/25854736dac0768b05ae67f4f92d196e3229a957"
        },
        "date": 1785751989941,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 282.2,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 57.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 106.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 273.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 8.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 197.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 62,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 32.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 382.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 301.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 78.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 65,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 31,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 317.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 349.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 78.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 7.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 126,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 25.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 325.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 416.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 123.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 18,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 178,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 34.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 273.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 261.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 196.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 180,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 271.6,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 330.2,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 201,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 228.3,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 348.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 350.5,
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
          "id": "713769cc6d94f2e4b9e607faab79ab5cf6ecd29f",
          "message": "v0.7.0",
          "timestamp": "2026-08-03T16:53:49+02:00",
          "tree_id": "4175cadcbc6753895c48eb735a9bc694e1428565",
          "url": "https://github.com/DataLab-Platform/web/commit/713769cc6d94f2e4b9e607faab79ab5cf6ecd29f"
        },
        "date": 1785769084892,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 288,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 19.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 87.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 281.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 6.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 68.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 23.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 312.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 267,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 70.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 65,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 30.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 319.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 458,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 65.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 17.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 102,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 28.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 285.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 266.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 77.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 20.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 146,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 27.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 305.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 256.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 187.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 165,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.9,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 271.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 313.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 176.2,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 193.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 338.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 307.2,
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
          "id": "713769cc6d94f2e4b9e607faab79ab5cf6ecd29f",
          "message": "v0.7.0",
          "timestamp": "2026-08-03T16:53:49+02:00",
          "tree_id": "4175cadcbc6753895c48eb735a9bc694e1428565",
          "url": "https://github.com/DataLab-Platform/web/commit/713769cc6d94f2e4b9e607faab79ab5cf6ecd29f"
        },
        "date": 1785770094554,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 239.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 14.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 56.4,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 231,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 8.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 230.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 90,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 33.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 351.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 237.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 79.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 60,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 29.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 340,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 357.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 166.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 8.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 110,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 19.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 337.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 331.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 111.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 15.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 172,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 30.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 262.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 227.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 178.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 160.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 252.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 216.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 186,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 168.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 326.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 318.5,
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
          "id": "73bdb614428eeb206f7510ae6e6f1ed0a22b779d",
          "message": "feat: support mixed signal axis groups\n\nAdd a transactional axis organizer for shared and separate signal plots.\nPersist group assignments by object UUID and restore them across selections.\nSynchronize compatible X axes and share layouts with detached plot views.\nPreserve unique object UUIDs across creation, duplication, and HDF5 reloads.\nAdd French translations, release notes, and unit, Python, and E2E coverage.\n\nCloses #16",
          "timestamp": "2026-08-06T14:15:15+02:00",
          "tree_id": "da466b1f65dfdfd479efa0ecf0da2b3d9903de61",
          "url": "https://github.com/DataLab-Platform/web/commit/73bdb614428eeb206f7510ae6e6f1ed0a22b779d"
        },
        "date": 1786018747924,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 314.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 17.7,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": -2.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 307.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 6.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 27.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 0,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 19.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 272.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 212.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 76.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 66,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 33.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 349.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 321.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 180.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 17.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 104,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 19.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 338.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 239.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 128.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 13,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 202,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 20,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 288.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 228.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.8,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 165.3,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 167.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.9,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 288.7,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 319.8,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 153,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 190.7,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 305.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 323.2,
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
          "id": "16517c08b40b79f2498fd13f3515729eb815ca19",
          "message": "feat: add demo workspaces and preload functionality for deep linking",
          "timestamp": "2026-08-07T15:08:47+02:00",
          "tree_id": "7643062d7f5955b04ba3c4646228e3395b4bc0fb",
          "url": "https://github.com/DataLab-Platform/web/commit/16517c08b40b79f2498fd13f3515729eb815ca19"
        },
        "date": 1786108364761,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 201.1,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 12.9,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 29.5,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 194,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 7.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 76.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 57,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 23.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 243.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 263.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 86.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 106,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 51.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 437.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 336.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 186,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 10.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 102,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 16.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 388,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 248.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 93.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 26.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 174,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 36.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 377.5,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 244.8,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 208.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 184.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 291.9,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 349.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 205.6,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 222.1,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 383.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 343.3,
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
          "id": "ef13d21501b58f1e1f77644f1371882b718bdc72",
          "message": "v0.8.0",
          "timestamp": "2026-08-07T15:27:13+02:00",
          "tree_id": "5577bcf7170616f7e9450f2efc0839cfbb4f4fe8",
          "url": "https://github.com/DataLab-Platform/web/commit/ef13d21501b58f1e1f77644f1371882b718bdc72"
        },
        "date": 1786109491324,
        "tool": "customSmallerIsBetter",
        "benches": [
          {
            "name": "image_perf · multi-select → grid",
            "value": 383.3,
            "unit": "ms"
          },
          {
            "name": "image_perf · getImagesData (×4)",
            "value": 14.8,
            "unit": "ms"
          },
          {
            "name": "image_perf · single Plotly render",
            "value": 68,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid React commit",
            "value": 358.6,
            "unit": "ms"
          },
          {
            "name": "image_perf · grid canvas paint",
            "value": 24.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [10000 pts]",
            "value": 56.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [10000 pts]",
            "value": 51,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [10000 pts]",
            "value": 22.7,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [10000 pts]",
            "value": 399.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [10000 pts]",
            "value": 340.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [100000 pts]",
            "value": 128.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [100000 pts]",
            "value": 107,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [100000 pts]",
            "value": 66.6,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [100000 pts]",
            "value": 439.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [100000 pts]",
            "value": 359.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [500000 pts]",
            "value": 98,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [500000 pts]",
            "value": 15.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [500000 pts]",
            "value": 125,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [500000 pts]",
            "value": 59.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [500000 pts]",
            "value": 382.8,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [500000 pts]",
            "value": 288.2,
            "unit": "ms"
          },
          {
            "name": "signal_perf · select → visible [1000000 pts]",
            "value": 86.4,
            "unit": "ms"
          },
          {
            "name": "signal_perf · binary fetch median [1000000 pts]",
            "value": 23.9,
            "unit": "ms"
          },
          {
            "name": "signal_perf · longest task [1000000 pts]",
            "value": 263,
            "unit": "ms"
          },
          {
            "name": "signal_perf · hover [1000000 pts]",
            "value": 32.1,
            "unit": "ms"
          },
          {
            "name": "signal_perf · pan [1000000 pts]",
            "value": 319.3,
            "unit": "ms"
          },
          {
            "name": "signal_perf · zoom [1000000 pts]",
            "value": 257.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [1024² ×16 float64]",
            "value": 160.1,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [1024² ×16 float64]",
            "value": 196.4,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [1024² ×16 float64]",
            "value": 156.1,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · ram Δheap [2048² ×8 float64]",
            "value": 167.2,
            "unit": "MiB"
          },
          {
            "name": "opfs_storage · disk add [2048² ×8 float64]",
            "value": 267.2,
            "unit": "ms"
          },
          {
            "name": "opfs_storage · disk read [2048² ×8 float64]",
            "value": 309.2,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [1024² ×16 float64]",
            "value": 188,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [1024² ×16 float64]",
            "value": 209.9,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · async add [2048² ×8 float64]",
            "value": 338.5,
            "unit": "ms"
          },
          {
            "name": "opfs_worker · sync add [2048² ×8 float64]",
            "value": 294.8,
            "unit": "ms"
          }
        ]
      }
    ]
  }
}