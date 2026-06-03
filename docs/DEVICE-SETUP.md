# Device Setup Guide

## J&R JR_337__OneKey

| Setting | Value |
|---|---|
| SIP Server | YOUR_SERVER_PUBLIC_IP |
| SIP Port | 5060 |
| Line Number | Must be numeric (e.g. 1001) |
| Username | Same as Line Number |
| Password | As set in dashboard |
| Dial Number | 9999 |
| Transport | UDP |

## PortSIP iOS

| Setting | Value |
|---|---|
| SIP Server | YOUR_SIP_DOMAIN |
| SIP Port | 5060 |
| Username | Your assigned SIP ID |
| Transport | UDP |
| Video | Enable |

## IP Speaker (TSIP)

| Setting | Value |
|---|---|
| SIP Server | YOUR_SERVER_IP |
| SIP Port | 5060 |
| Transport | UDP |
| Auto Answer | Enable |

## Network Requirements

| Port | Protocol | Purpose |
|---|---|---|
| 5060 | UDP | SIP registration |
| 10000-20000 | UDP | RTP audio/video |
| 443 | TCP | Dashboard HTTPS |
