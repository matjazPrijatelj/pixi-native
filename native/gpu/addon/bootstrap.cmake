if(NOT DEFINED PIXI_NATIVE_GPU_ADDON_DIR)
    message(FATAL_ERROR "PIXI_NATIVE_GPU_ADDON_DIR must point at the project-owned addon")
endif()

# CMAKE_PROJECT_INCLUDE also runs for nested project() calls. Register the
# project-owned target exactly once; CMake resolves its Dawn link targets when
# generation finishes.
get_property(PIXI_NATIVE_GPU_ADDED GLOBAL PROPERTY PIXI_NATIVE_GPU_ADDED)
if(NOT PIXI_NATIVE_GPU_ADDED)
    set_property(GLOBAL PROPERTY PIXI_NATIVE_GPU_ADDED TRUE)
    add_subdirectory(
        "${PIXI_NATIVE_GPU_ADDON_DIR}"
        "${CMAKE_BINARY_DIR}/pixi-native-addon"
    )
endif()
