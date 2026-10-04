"""Mở Chrome qua Selenium Manager (tự khớp chromedriver với Chrome)."""
def attach_chrome(webdriver, options):
    return webdriver.Chrome(options=options)
