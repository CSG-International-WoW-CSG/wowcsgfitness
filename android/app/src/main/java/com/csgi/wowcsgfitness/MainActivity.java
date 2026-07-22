package com.csgi.wowcsgfitness;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(TrackingKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
