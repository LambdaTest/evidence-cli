---
mode: testing
max_steps: 50
target: chrome
headless: false
variables:
  global.qaNestedFlag1786691368596:
    value: 'on'
    secret: false
    syntax: '{{qaNestedFlag1786691368596}}'
    type: global
  secrets.user.CVV:
    value: '***'
    secret: true
    syntax: '{{CVV}}'
    type: secret
---

# Session: kane-cli-demo

## Step 1
go to https://ltqa-domsetu.vercel.app/ switch to nested iframe and complete the checkout flow
