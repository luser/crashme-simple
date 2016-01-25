#!/bin/bash

XPI=crashme-simple.xpi
ANDROID_APP_ID=org.mozilla.fennec

# Push the add-on to your device to test
adb push "$XPI" /sdcard/"$XPI" && \
adb push install.html /sdcard/install.html && \
adb shell am start -a android.intent.action.VIEW \
                   -c android.intent.category.DEFAULT \
                   -d file:///mnt/sdcard/install.html \
                   -n $ANDROID_APP_ID/.App && \
echo Pushed $XPI to $ANDROID_APP_ID
